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

export type IScheduler = {
    getSchedule(scheduleId: ScheduleId, orgId: OrgId, cookie: string): Promise<Roster>;
}

export class Scheduler implements IScheduler {
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
        const url = `${this.cmsEndpoint}/v1/schedules/${scheduleId}?org_id=${orgId}`;
        const config: AxiosRequestConfig = {
            headers: {
                "Cookie": `access=${cookie}`
            },
            responseType: "json",
            responseEncoding: "utf8",
            maxRedirects: 5,
            transformResponse: [
                (data: string) => {
                    return JSON.parse(data) as Roster;
                }
            ]
        };
        const axios = new Axios(config);
        const response = await axios.get<Roster>(url);

        if (!response.status || response.status !== 200) {
            throw new Error(`Failed to get schedule ${scheduleId} for org ${orgId}: ${response.status} : ${response.statusText}: Access Cookie: ${cookie}`);
        }

        const roster = response.data;

        if (!roster) {
            throw new Error(`Failed to get schedule ${scheduleId} for org ${orgId}: No data: ${JSON.stringify(response)}`);
        }
        if (roster.class_roster_students === undefined) {
            throw new Error(`Failed to get schedule ${scheduleId} for org ${orgId}: No students: ${JSON.stringify(roster)}`);
        }
        if (roster.class_roster_teachers === undefined) {
            throw new Error(`Failed to get schedule ${scheduleId} for org ${orgId}: No teachers: ${JSON.stringify(roster)}`);
        }
        return roster;
    }
}

export class MockScheduler implements IScheduler {
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    public constructor(private readonly numStudents: number, private readonly numTeachers: number) {}
    public async getSchedule(_scheduleId: ScheduleId, _orgId: OrgId, _cookie: string): Promise<Roster> {
        const students = [];
        for (let i = 0; i < this.numStudents; i++) {
            students.push({
                id: `student-${i}`,
                name: `Student ${i}`,
                type: "student",
                enable: true
            });
        }
        const teachers = [];
        for (let i = 0; i < this.numTeachers; i++) {
            teachers.push({
                id: `teacher-${i}`,
                name: `Teacher ${i}`,
                type: "teacher",
                enable: true
            });
        }
        return {
            class_roster_students: students,
            class_roster_teachers: teachers
        };
    }
}
