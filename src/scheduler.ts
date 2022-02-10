import LRUCache from "lru-cache";
import {Type} from "./redis";
import fetch, {Headers} from "node-fetch";

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
        if (process.env.DISABLE_AUTH) {
            return {
                class_roster_students: [
                    {id: "1", name: "Student 1", type: "student", enable: true},
                    {id: "2", name: "Student 2", type: "student", enable: true},
                    {id: "3", name: "Student 3", type: "student", enable: true},
                    {id: "4", name: "Student 4", type: "student", enable: true},
                    {id: "5", name: "Student 5", type: "student", enable: true},
                ],
                class_roster_teachers: [
                    {id: "1", name: "Teacher 1", type: "teacher", enable: true},
                    {id: "2", name: "Teacher 2", type: "teacher", enable: true},
                    {id: "3", name: "Teacher 3", type: "teacher", enable: true},
                ]
            };
        }

        const url = `${this.cmsEndpoint}/v1/schedules/${scheduleId}?orgId=${orgId}`;
        const headers = new Headers();
        headers.append("Accept", "application/json");
        headers.append("Content-Type", "application/json");
        headers.append("Set-Cookie", cookie);
        const response = await fetch(url, {
            headers,
            method: "GET",
        });
        if (!response.ok) {
            throw new Error(`Failed to get schedule ${scheduleId} for org ${orgId}`);
        }
        return await response.json() as Roster;
    }
}
