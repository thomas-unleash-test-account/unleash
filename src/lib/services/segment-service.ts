import { IUnleashConfig } from '../types/option';
import { IEventStore } from '../types/stores/event-store';
import { IUnleashStores } from '../types';
import { Logger } from '../logger';
import NameExistsError from '../error/name-exists-error';
import { ISegmentStore } from '../types/stores/segment-store';
import { IFeatureStrategy, ISegment } from '../types/model';
import { segmentSchema } from './segment-schema';
import {
    SEGMENT_CREATED,
    SEGMENT_DELETED,
    SEGMENT_UPDATED,
} from '../types/events';
import User from '../types/user';
import { IFeatureStrategiesStore } from '../types/stores/feature-strategies-store';
import BadDataError from '../error/bad-data-error';
import {
    SEGMENT_VALUES_LIMIT,
    STRATEGY_SEGMENTS_LIMIT,
} from '../util/segments';

export class SegmentService {
    private logger: Logger;

    private segmentStore: ISegmentStore;

    private featureStrategiesStore: IFeatureStrategiesStore;

    private eventStore: IEventStore;

    constructor(
        {
            segmentStore,
            featureStrategiesStore,
            eventStore,
        }: Pick<
            IUnleashStores,
            'segmentStore' | 'featureStrategiesStore' | 'eventStore'
        >,
        { getLogger }: Pick<IUnleashConfig, 'getLogger'>,
    ) {
        this.segmentStore = segmentStore;
        this.featureStrategiesStore = featureStrategiesStore;
        this.eventStore = eventStore;
        this.logger = getLogger('services/segment-service.ts');
    }

    async get(id: number): Promise<ISegment> {
        return this.segmentStore.get(id);
    }

    async getAll(): Promise<ISegment[]> {
        return this.segmentStore.getAll();
    }

    async getActive(): Promise<ISegment[]> {
        return this.segmentStore.getActive();
    }

    // Used by unleash-enterprise.
    async getByStrategy(strategyId: string): Promise<ISegment[]> {
        return this.segmentStore.getByStrategy(strategyId);
    }

    // Used by unleash-enterprise.
    async getStrategies(id: number): Promise<IFeatureStrategy[]> {
        return this.featureStrategiesStore.getStrategiesBySegment(id);
    }

    async create(data: unknown, user: User): Promise<void> {
        const input = await segmentSchema.validateAsync(data);
        SegmentService.validateSegmentValuesLimit(input);
        await this.validateName(input.name);

        const segment = await this.segmentStore.create(input, user);

        await this.eventStore.store({
            type: SEGMENT_CREATED,
            createdBy: user.email || user.username,
            data: segment,
        });
    }

    async update(id: number, data: unknown, user: User): Promise<void> {
        const input = await segmentSchema.validateAsync(data);
        SegmentService.validateSegmentValuesLimit(input);
        const preData = await this.segmentStore.get(id);

        if (preData.name !== input.name) {
            await this.validateName(input.name);
        }

        const segment = await this.segmentStore.update(id, input);

        await this.eventStore.store({
            type: SEGMENT_UPDATED,
            createdBy: user.email || user.username,
            data: segment,
            preData,
        });
    }

    async delete(id: number, user: User): Promise<void> {
        const segment = this.segmentStore.get(id);
        await this.segmentStore.delete(id);
        await this.eventStore.store({
            type: SEGMENT_DELETED,
            createdBy: user.email || user.username,
            data: segment,
        });
    }

    // Used by unleash-enterprise.
    async addToStrategy(id: number, strategyId: string): Promise<void> {
        await this.validateStrategySegmentLimit(strategyId);
        await this.segmentStore.addToStrategy(id, strategyId);
    }

    // Used by unleash-enterprise.
    async removeFromStrategy(id: number, strategyId: string): Promise<void> {
        await this.segmentStore.removeFromStrategy(id, strategyId);
    }

    async validateName(name: string): Promise<void> {
        if (!name) {
            throw new BadDataError('Segment name cannot be empty');
        }

        if (await this.segmentStore.existsByName(name)) {
            throw new NameExistsError('Segment name already exists');
        }
    }

    private async validateStrategySegmentLimit(
        strategyId: string,
    ): Promise<void> {
        const limit = STRATEGY_SEGMENTS_LIMIT;

        if (typeof limit === 'undefined') {
            return;
        }

        if ((await this.getByStrategy(strategyId)).length >= limit) {
            throw new BadDataError(
                `Strategies may not have more than ${limit} segments`,
            );
        }
    }

    private static validateSegmentValuesLimit(
        segment: Omit<ISegment, 'id'>,
    ): void {
        const limit = SEGMENT_VALUES_LIMIT;

        const valuesCount = segment.constraints
            .flatMap((constraint) => constraint.values?.length ?? 0)
            .reduce((acc, length) => acc + length, 0);

        if (valuesCount > limit) {
            throw new BadDataError(
                `Segments may not have more than ${limit} values`,
            );
        }
    }
}
