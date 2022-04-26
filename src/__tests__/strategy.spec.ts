import {
    newProducerId,
    newSfuId,
    Registrar,
    RoomId,
    selectSfuFromLoad,
    SfuId,
    SfuStatus,
    TrackInfo,
    TrackInfoEvent
} from "../redis";
import {FromScheduleStrategy, RandomStrategy} from "../strategy";
import {Scheduler, newOrgId, newScheduleId} from "../scheduler";

class MockRegistrar implements Registrar {
    private sfuStatuses = new Map<SfuId, SfuStatus>();
    public constructor(private readonly sfuIds: SfuId[], private readonly tracks: TrackInfo[]) {
        for (const sfuId of this.sfuIds) {
            this.sfuStatuses.set(sfuId, {
                endpoint: "http://localhost:8080",
                producers: 0,
                consumers: 0,
            });
        }
    }

    public async getAvailableSfu(newLoad: number, excludeId?: SfuId): Promise<SfuId> {
        const sfuStatuses = (await Promise.allSettled(this.sfuIds.map(async sfuId => {
            return {id: sfuId, status: await this.getSfuStatus(sfuId) };
        })))
            .flatMap((result) => result.status === "fulfilled" ? result.value : []);
        const id = await selectSfuFromLoad(newLoad, sfuStatuses, excludeId);
        if (id) {
            return id;
        }
        return await this.getRandomSfuId(excludeId);
    }

    public async getRandomSfuId(excludeId?: SfuId): Promise<SfuId> {
        const sfuIds = await this.getSfuIds(excludeId);
        const randomIndex = Math.floor(Math.random()*sfuIds.length);
        return sfuIds[randomIndex];
    }

    public async getSfuIds(excludeId?: SfuId): Promise<SfuId[]> {
        if (this.sfuIds.length > 1) {
            return this.sfuIds.filter(id => id !== excludeId);
        }
        return this.sfuIds;
    }

    public async getSfuStatus(sfuId: SfuId): Promise<SfuStatus> {
        const status = this.sfuStatuses.get(sfuId);
        if (status) {
            return status;
        }
        throw new Error(`Sfu ${sfuId} not found`);
    }

    public async getTracks(_roomId: RoomId): Promise<TrackInfo[]> {
        return this.tracks;
    }

    public async waitForTrackChanges(_roomId: RoomId, _cursor?: string): Promise<{ cursor?: string; events?: TrackInfoEvent[] }> {
        throw new Error("Not implemented");
    }

    public setSfuStatus(sfuId: SfuId, status: SfuStatus) {
        this.sfuStatuses.set(sfuId, status);
    }
}

describe("selectSfu", () => {
    it("should get an SfuId from RandomStrategy", async () => {
        const sfuIds = [newSfuId("1"), newSfuId("2"), newSfuId("3")];
        const tracks: TrackInfo[] = [
            {sfuId: newSfuId("1"), producerId: newProducerId("2")},
        ];
        const mockRegistrar = new MockRegistrar(sfuIds, tracks);
        const strategy = new RandomStrategy(tracks, mockRegistrar);
        const sfu = await strategy.getSfuId();
        expect(sfu).toBeDefined();
        expect(sfuIds.find(id => id === sfu)).toBeDefined();
    });

    it("should exclude an sfu on RandomStrategy", async () => {
        const sfuIds = [newSfuId("1"), newSfuId("2")];
        const tracks: TrackInfo[] = [
            {sfuId: newSfuId("1"), producerId: newProducerId("2")},
        ];
        const mockRegistrar = new MockRegistrar(sfuIds, tracks);
        const strategy = new RandomStrategy(tracks, mockRegistrar);
        for (let i = 0; i < 100; i++) {
            const sfu = await strategy.getSfuId(newSfuId("1"));
            expect(sfu).toBeDefined();
            expect(sfuIds.find(id => id === sfu)).toBeDefined();
            expect(sfu).toEqual(newSfuId("2"));
        }
    });

    it("should get an SfuId from RandomStrategy with no tracks", async () => {
        const sfuIds = [newSfuId("1"), newSfuId("2"), newSfuId("3")];
        const tracks: TrackInfo[] = [];
        const mockRegistrar = new MockRegistrar(sfuIds, tracks);
        const strategy = new RandomStrategy(tracks, mockRegistrar);
        const sfu = await strategy.getSfuId();
        expect(sfu).toBeDefined();
        expect(sfuIds.find(id => id === sfu)).toBeDefined();
    });

    it("should get an SfuId from FromScheduleStrategy", async () => {
        const sfuIds = [newSfuId("1"), newSfuId("2"), newSfuId("3")];
        const tracks: TrackInfo[] = [
            {sfuId: newSfuId("1"), producerId: newProducerId("2")},
        ];
        const mockRegistrar = new MockRegistrar(sfuIds, tracks);
        const scheduler = new Scheduler("1");
        const strategy = new FromScheduleStrategy(tracks, mockRegistrar, scheduler, newScheduleId("1"), newOrgId("2"), "");
        const sfu = await strategy.getSfuId();
        expect(sfu).toBeDefined();
        expect(sfu).toEqual(newSfuId("1"));
    });

    it("should get an SfuId from FromScheduleStrategy with no tracks", async () => {
        const sfuIds = [newSfuId("1"), newSfuId("2"), newSfuId("3")];
        const tracks: TrackInfo[] = [];
        const mockRegistrar = new MockRegistrar(sfuIds, tracks);
        const scheduler = new Scheduler("1");
        const strategy = new FromScheduleStrategy(tracks, mockRegistrar, scheduler, newScheduleId("1"), newOrgId("2"), "");
        const sfu = await strategy.getSfuId();
        expect(sfu).toBeDefined();
        expect(sfuIds.find(id => id === sfu)).toBeDefined();
    });

    it("should try not to overload an sfu from FromScheduleStrategy", async () =>{
        const sfuIds = [newSfuId("1"), newSfuId("2")];
        const tracks: TrackInfo[] = [
            {sfuId: newSfuId("1"), producerId: newProducerId("2")},
        ];
        const mockRegistrar = new MockRegistrar(sfuIds, tracks);
        mockRegistrar.setSfuStatus(newSfuId("1"), {
            endpoint: "endpoint",
            producers: 250,
            consumers: 250
        });
        const scheduler = new Scheduler("1");
        const strategy = new FromScheduleStrategy(tracks, mockRegistrar, scheduler, newScheduleId("1"), newOrgId("2"), "");
        const sfu = await strategy.getSfuId();
        expect(sfu).toBeDefined();
        expect(sfu).toEqual(newSfuId("2"));
    });

    it("should throw when there are no SFUs available for RandomStrategy", async () => {
        const sfuIds: SfuId[] = [];
        const tracks: TrackInfo[] = [];
        const mockRegistrar = new MockRegistrar(sfuIds, tracks);
        const strategy = new RandomStrategy(tracks, mockRegistrar);
        await expect(strategy.getSfuId()).rejects.toThrow();
    });

    it("should return undefined when there are no SFUs available for FromScheduleStrategy", async () => {
        const sfuIds: SfuId[] = [];
        const tracks: TrackInfo[] = [];
        const mockRegistrar = new MockRegistrar(sfuIds, tracks);
        const scheduler = new Scheduler("1");
        const strategy = new FromScheduleStrategy(tracks, mockRegistrar, scheduler, newScheduleId("1"), newOrgId("2"), "");
        const sfuId = await strategy.getSfuId();
        await expect(sfuId).toBeUndefined();
    });

    it("should clear the schedule after expiration", async () => {
        const sfuIds: SfuId[] = [];
        const tracks: TrackInfo[] = [];
        const mockRegistrar = new MockRegistrar(sfuIds, tracks);
        const scheduler = new Scheduler("1");
        const strategy = new FromScheduleStrategy(tracks, mockRegistrar, scheduler, newScheduleId("1"), newOrgId("2"), "");
        await strategy.getSfuId();
        await new Promise<void>(resolve => setTimeout(resolve, 1000));
        expect(scheduler.cacheSize).toEqual(0);
    });
});
