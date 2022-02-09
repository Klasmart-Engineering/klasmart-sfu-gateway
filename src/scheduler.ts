import LRUCache from "lru-cache";
import {Type} from "./redis";

export type ScheduleId = Type<"ScheduleId">;
export const newScheduleId = (id: string) => id as ScheduleId;

export type OrgId = Type<"OrgId">;
export const newOrgId = (id: string) => id as OrgId;

type Roster = {
    class_roster_teachers: {id: string, name: string, type: string, enable: boolean}[];
    class_roster_students: {id: string, name: string, type: string, enable: boolean}[];
};

export class Scheduler {
    public constructor(
        private readonly cmsEndpoint: string,
        private cache: LRUCache<string, Roster> = new LRUCache( {
            max: 100000,
            maxAge: 1000 * 15,
            stale: false,
            updateAgeOnGet: false
        })) {
    }

    public async getSchedule(scheduleId: ScheduleId, orgId: OrgId, cookie: string) {
        let schedule = this.cache.get(`${scheduleId}-${orgId}`);
        if (schedule) {
            return schedule;
        }

        schedule = await this.getUpdatedSchedule(scheduleId, orgId, cookie);
        this.cache.set(`${scheduleId}-${orgId}`, schedule);
        return schedule;
    }

    private async getUpdatedSchedule(scheduleId: ScheduleId, orgId: OrgId, cookie: string): Promise<Roster> {
        const url = `${this.cmsEndpoint}/v1/schedules/${scheduleId}?orgId=${orgId}`;
        const headers = new Headers();
        headers.append("Accept", "application/json");
        headers.append("Content-Type", "application/json");
        headers.append("Set-Cookie", cookie);
        const response = await fetch(url, {
            headers,
            method: "GET",
            credentials: "include",
        });
        if (!response.ok) {
            throw new Error(`Failed to get schedule ${scheduleId} for org ${orgId}`);
        }
        return await response.json();
    }
}
