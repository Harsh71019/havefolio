import {
  callEnrichmentProvider,
  EnrichmentCircuit,
  type EnrichmentProvider,
} from '@havefolio/domain';
import { EventLogger, jobContext, logContext } from '@havefolio/logging';
import { Inject, Injectable } from '@nestjs/common';
import { EnrichmentRepository } from './enrichment.repository.js';
export const ENRICHMENT_PROVIDERS = 'ENRICHMENT_PROVIDERS';
/** Empty in production. Only deterministic test adapters are registered in this ticket. */
@Injectable()
export class EnrichmentWorkerService {
  private busy = false;
  private readonly circuits = new Map<string, EnrichmentCircuit>();
  private readonly outstanding = new Set<string>();
  constructor(
    private readonly repository: EnrichmentRepository,
    @Inject(ENRICHMENT_PROVIDERS) private readonly providers: readonly EnrichmentProvider[],
    private readonly logger: EventLogger,
  ) {}
  async process(id: string): Promise<void> {
    return logContext.run(jobContext(undefined, id, 0), () => this.execute(id));
  }
  private async execute(id: string): Promise<void> {
    if (this.busy || !this.repository.store) return;
    this.busy = true;
    try {
      const claim = await this.repository.store.claim(id);
      if (!claim) return;
      const provider = this.providers.find((p) => p.kinds.includes(claim.input.kind));
      if (!provider) {
        await this.repository.store.finish(claim, 'unconfigured');
        return;
      }
      const circuit = this.circuits.get(provider.id) ?? new EnrichmentCircuit();
      this.circuits.set(provider.id, circuit);
      if (circuit.isOpen() || this.outstanding.has(provider.id)) {
        await this.repository.store.finish(claim, 'circuit');
        return;
      }
      try {
        // Retain a slot until the actual adapter settles, even after timeout. A misbehaving
        // cancellation-ignoring adapter can never accumulate unbounded outstanding calls.
        const bounded: EnrichmentProvider = {
          id: provider.id,
          kinds: provider.kinds,
          suggest: (input, signal) => {
            this.outstanding.add(provider.id);
            return Promise.resolve()
              .then(() => provider.suggest(input, signal))
              .finally(() => this.outstanding.delete(provider.id));
          },
        };
        const result = await callEnrichmentProvider(bounded, claim.input);
        circuit.success();
        await this.repository.store.finish(claim, 'succeeded', result);
      } catch {
        circuit.failure();
        await this.repository.store.finish(claim, 'failed');
        this.logger.emit('warn', {
          event: 'job_retry',
          component: 'enrichment',
          operation: 'suggest',
          code: 'ENRICHMENT_PROVIDER_FAILED',
          category: 'operational_failure',
        });
      }
    } finally {
      this.busy = false;
    }
  }
}
