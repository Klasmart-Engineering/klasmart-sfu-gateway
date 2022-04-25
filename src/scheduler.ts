import Keyv from "keyv";
import {Type} from "./redis";
import {Axios, AxiosRequestConfig} from "axios";

export type ScheduleId = Type<"ScheduleId">;
export const newScheduleId = (id: string) => id as ScheduleId;

export type OrgId = Type<"OrgId">;
export const newOrgId = (id: string) => id as OrgId;

type Roster = {
    class_roster_teachers: {id: string}[];
    class_roster_students: {id: string}[];
};

export type IScheduler = {
    getSchedule(scheduleId: ScheduleId, orgId: OrgId, cookie: string): Promise<Roster>;
}

export class Scheduler implements IScheduler {
    public constructor(
        private readonly cmsEndpoint: string,
        private cache: Keyv<Roster> = new Keyv(),
        private ttl: number = getEnvNumber("CACHE_TTL", 15000)) {
    }

    public async getSchedule(scheduleId: ScheduleId, orgId: OrgId, cookie: string) {
        let schedule = await this.cache.get(`${scheduleId}-${orgId}`);
        if (schedule) {
            return schedule;
        }

        schedule = await this.getUpdatedSchedule(scheduleId, orgId, cookie);
        await this.cache.set(`${scheduleId}-${orgId}`, schedule, this.ttl);
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
        if (roster.class_roster_students === undefined || roster.class_roster_students === null) {
            roster.class_roster_students = [];
        }
        if (roster.class_roster_teachers === undefined || roster.class_roster_teachers === null) {
            roster.class_roster_teachers = [];
        }

        // Don't store any unneeded data in the cache
        return {
            class_roster_students: roster.class_roster_students.map(member => {
                return {
                    id: member.id,
                };
            }),
            class_roster_teachers: roster.class_roster_teachers.map(member => {
                return {
                    id: member.id,
                };
            }),
        };
    }
}

export class MockScheduler implements IScheduler {
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    private rosters = new Map<ScheduleId, Roster>();
    public constructor(private readonly numStudents: number, private readonly numTeachers: number) {}
    public async getSchedule(scheduleId: ScheduleId, _orgId: OrgId, _cookie: string): Promise<Roster> {
        const roster = this.rosters.get(scheduleId);
        if (roster) {
            return roster;
        }
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
    public setRoster(scheduleId: ScheduleId, roster: Roster) {
        this.rosters.set(scheduleId, roster);
    }
}
