import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PermissionCode } from "@/lib/auth/permissions";
import type { AuthenticatedUser } from "@/lib/auth/types";
import { AuthorizationError } from "@/lib/auth/types";

const repository = vi.hoisted(() => ({
  getActiveRepresentativeIdByUserPostgres: vi.fn(),
  createPromisePostgres: vi.fn(),
  getPromisePostgres: vi.fn(),
  getPromiseDetailsPostgres: vi.fn(),
  listPromisesPostgres: vi.fn(),
  updatePromisePostgres: vi.fn(),
  addFollowUpPostgres: vi.fn(),
  rejectPromisePostgres: vi.fn(),
  cancelPromisePostgres: vi.fn(),
  allocateConfirmedCollectionPostgres: vi.fn(),
  reverseCollectionAllocationPostgres: vi.fn(),
  escalatePromisePostgres: vi.fn(),
  getPromiseHistoryPostgres: vi.fn(),
  getDuePromisesPostgres: vi.fn(),
  getOverduePromisesPostgres: vi.fn(),
  getCustomerPromiseSummaryPostgres: vi.fn(),
  getSalespersonPromiseSummaryPostgres: vi.fn(),
  getPromiseDashboardSummaryPostgres: vi.fn(),
  getPromiseFormOptionsPostgres: vi.fn(),
  listAvailableConfirmedCollectionsPostgres: vi.fn(),
}));
vi.mock("./postgres-repository", () => repository);

import {
  allocateConfirmedCollection,
  createPromise,
  getPromise,
  getPromiseDetails,
  listPromises,
  reverseCollectionAllocation,
  updatePromise,
} from "./service";

const promiseId = "10000000-0000-4000-8000-000000000001";
const allocationId = "10000000-0000-4000-8000-000000000002";

function actor(
  permissions: readonly PermissionCode[],
  roles: AuthenticatedUser["roles"] = ["BRANCH_MANAGER"],
): AuthenticatedUser {
  return {
    id: "10000000-0000-4000-8000-000000000010",
    email: "promise.service@example.test",
    fullName: "مستخدم خدمة الوعود",
    roles,
    permissions: new Set(permissions),
    operatingMode: "SINGLE_MANAGER",
    mustChangePassword: false,
  };
}

function commandContext(
  permissions: readonly PermissionCode[],
  roles: AuthenticatedUser["roles"] = ["BRANCH_MANAGER"],
) {
  return {
    actor: actor(permissions, roles),
    request: {
      requestId: "10000000-0000-4000-8000-000000000011",
      ipAddress: "127.0.0.1",
      userAgent: "vitest",
    },
    idempotencyKey: "promise-service-idempotency-001",
  } as const;
}

describe("payment promise service authorization", () => {
  beforeEach(() => {
    for (const mock of Object.values(repository)) mock.mockReset();
  });

  it("يرفض إنشاء وعد دون صلاحية ولا يصل إلى المستودع", async () => {
    await expect(
      createPromise(
        {} as never,
        {
          customerId: promiseId,
          customerAccountId: promiseId,
          representativeId: promiseId,
          currencyCode: "SR",
          promisedAmountMinor: 100,
          promiseDate: "2026-07-18",
          dueDate: "2026-07-18",
          debtReason: "دين",
        },
        commandContext([]),
      ),
    ).rejects.toBeInstanceOf(AuthorizationError);
    expect(repository.createPromisePostgres).not.toHaveBeenCalled();
  });

  it("لا تمنح القراءة صلاحية تخصيص التحصيل", async () => {
    await expect(
      allocateConfirmedCollection(
        {} as never,
        promiseId,
        { collectionId: promiseId, amountMinor: 100 },
        commandContext(["promises.read"]),
      ),
    ).rejects.toBeInstanceOf(AuthorizationError);
    expect(repository.allocateConfirmedCollectionPostgres).not.toHaveBeenCalled();
  });

  it("تفصل صلاحية التخصيص عن صلاحية العكس", async () => {
    repository.allocateConfirmedCollectionPostgres.mockResolvedValue({ ok: true });
    await expect(
      allocateConfirmedCollection(
        {} as never,
        promiseId,
        { collectionId: promiseId, amountMinor: 100 },
        commandContext(["promises.allocate_collection"]),
      ),
    ).resolves.toEqual({ ok: true });
    await expect(
      reverseCollectionAllocation(
        {} as never,
        promiseId,
        allocationId,
        { reason: "إلغاء الربط" },
        commandContext(["promises.allocate_collection"]),
      ),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("يسمح بالعكس عند وجود الصلاحية المخصصة", async () => {
    repository.reverseCollectionAllocationPostgres.mockResolvedValue({ reversed: true });
    await expect(
      reverseCollectionAllocation(
        {} as never,
        promiseId,
        allocationId,
        { reason: "سند معكوس" },
        commandContext(["promises.reverse_allocation"]),
      ),
    ).resolves.toEqual({ reversed: true });
  });

  it("يحجب سجل الأحداث عن مستخدم القراءة بلا view_history", async () => {
    repository.getPromiseDetailsPostgres.mockResolvedValue({
      promise: { id: promiseId },
      events: [{ id: "event" }],
      followUps: [],
      allocations: [],
    });
    const result = await getPromiseDetails(
      {} as never,
      promiseId,
      { actor: actor(["promises.read"]) },
    );
    expect(result.events).toEqual([]);
  });

  it("يقيد مستخدم SALES_REP بمندوبه الفعلي في القراءة والقائمة", async () => {
    const representativeId = "10000000-0000-4000-8000-000000000099";
    repository.getActiveRepresentativeIdByUserPostgres.mockResolvedValue(
      representativeId,
    );
    repository.getPromisePostgres.mockResolvedValue({ id: promiseId });
    repository.listPromisesPostgres.mockResolvedValue({
      items: [],
      nextCursor: null,
    });
    const readContext = {
      actor: actor(["promises.read"], ["SALES_REP"]),
    } as const;

    await getPromise({} as never, promiseId, readContext);
    await listPromises({} as never, { limit: 25 }, readContext);

    expect(repository.getPromisePostgres).toHaveBeenCalledWith(
      expect.anything(),
      promiseId,
      representativeId,
    );
    expect(repository.listPromisesPostgres).toHaveBeenCalledWith(
      expect.anything(),
      { limit: 25 },
      representativeId,
    );
  });

  it("يرفض إنشاء أو إعادة تعيين وعد لمندوب آخر", async () => {
    const ownRepresentativeId = "10000000-0000-4000-8000-000000000098";
    repository.getActiveRepresentativeIdByUserPostgres.mockResolvedValue(
      ownRepresentativeId,
    );
    const scopedContext = commandContext(
      ["promises.create", "promises.update"],
      ["SALES_REP"],
    );
    const otherRepresentativeId =
      "10000000-0000-4000-8000-000000000097";

    await expect(
      createPromise(
        {} as never,
        {
          customerId: promiseId,
          customerAccountId: promiseId,
          representativeId: otherRepresentativeId,
          currencyCode: "SR",
          promisedAmountMinor: 100,
          promiseDate: "2026-07-18",
          dueDate: "2026-07-18",
          debtReason: "دين",
        },
        scopedContext,
      ),
    ).rejects.toBeInstanceOf(AuthorizationError);

    await expect(
      updatePromise(
        {} as never,
        promiseId,
        { version: 1, representativeId: otherRepresentativeId },
        scopedContext,
      ),
    ).rejects.toBeInstanceOf(AuthorizationError);
    expect(repository.createPromisePostgres).not.toHaveBeenCalled();
    expect(repository.updatePromisePostgres).not.toHaveBeenCalled();
  });

  it("يرفض SALES_REP غير المرتبط بسجل مندوب نشط", async () => {
    repository.getActiveRepresentativeIdByUserPostgres.mockResolvedValue(null);
    await expect(
      getPromise(
        {} as never,
        promiseId,
        { actor: actor(["promises.read"], ["SALES_REP"]) },
      ),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

});
