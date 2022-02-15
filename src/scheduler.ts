import LRUCache from "lru-cache";
import {Type} from "./redis";
import {Axios, AxiosRequestConfig} from "axios";

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

        const url = `${this.cmsEndpoint}/v1/schedules/${scheduleId}?org_id=${orgId}`;
        const config: AxiosRequestConfig<Roster> = {
            headers: {
                "set-cookie": `access=${cookie}`
            }
        };
        const axios = new Axios(config);
        const response = await axios.get<Roster>(url);

        if (!response.status || response.status !== 200) {
            throw new Error(`Failed to get schedule ${scheduleId} for org ${orgId}: ${response.status} : ${response.statusText}`);
        }
        return response.data;
    }
}
