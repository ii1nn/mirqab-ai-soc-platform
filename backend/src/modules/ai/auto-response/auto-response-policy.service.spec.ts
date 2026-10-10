import { Test } from '@nestjs/testing';
import { ResponseSlaService } from '../response-sla/response-sla.service';
import { AutoResponsePolicyService } from './auto-response-policy.service';

/**
 * AutoResponsePolicyService is now only the scheduler tick. The 3-minute
 * similarity window and the 15/30-minute severity SLA it used to run were
 * removed — every containment rule is tested in response-sla.service.spec.ts.
 */
describe('AutoResponsePolicyService (scheduler tick only)', () => {
  let service: AutoResponsePolicyService;
  let responseSla: { sweep: jest.Mock };

  beforeEach(async () => {
    responseSla = { sweep: jest.fn().mockResolvedValue(undefined) };
    const moduleRef = await Test.createTestingModule({
      providers: [AutoResponsePolicyService, { provide: ResponseSlaService, useValue: responseSla }],
    }).compile();
    service = moduleRef.get(AutoResponsePolicyService);
  });

  it('delegates every tick to the single authoritative ResponseSlaService.sweep()', async () => {
    await service.sweep();
    expect(responseSla.sweep).toHaveBeenCalledTimes(1);
  });

  it('no longer has the removed 3-minute or 15/30-minute isolation paths', () => {
    const proto = AutoResponsePolicyService.prototype as unknown as Record<string, unknown>;
    expect(proto.applyAiAutoResponseIfDue).toBeUndefined();
    expect(proto.applyContainmentPolicy).toBeUndefined();
    expect(proto.isPastResponseDeadline).toBeUndefined();
  });

  it('never lets a sweep failure crash the scheduler', async () => {
    responseSla.sweep.mockRejectedValue(new Error('database unavailable'));
    await expect(service.sweep()).resolves.toBeUndefined();
  });
});
