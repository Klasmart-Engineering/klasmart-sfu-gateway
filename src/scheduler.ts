import {Type} from "./redis";
import {Axios, AxiosRequestConfig} from "axios";
import {Logger} from "./logger";
import {getEnvNumber} from "./service";

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
        private cache = new Map<string, Roster>(),
        private ttl = getEnvNumber(process.env.CACHE_TTL, 15000)) {
    }

    public get cacheSize() {
        return this.cache.size;
    }

    public async getSchedule(scheduleId: ScheduleId, orgId: OrgId, cookie: string) {
        let schedule = await this.cache.get(`${scheduleId}-${orgId}`);
        if (schedule) {
            return schedule;
        }

        schedule = await this.getUpdatedSchedule(scheduleId, orgId, cookie);
        this.cache.set(`${scheduleId}-${orgId}`, schedule);
        setTimeout(() => {
            Logger.debug(`Deleting ${scheduleId}-${orgId} from cache`);
            this.cache.delete(`${scheduleId}-${orgId}`);
        }, this.ttl);
        return schedule;
    }

    private async getUpdatedSchedule(scheduleId: ScheduleId, orgId: OrgId, cookie: string): Promise<Roster> {
        if (process.env.DISABLE_AUTH) {
            return getMockSchedule();
        }

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

function getMockSchedule() {
    const numStudents = getEnvNumber(process.env.NUM_SCHEDULED_STUDENTS, 50);
    const numTeachers = getEnvNumber(process.env.NUM_SCHEDULED_TEACHERS, 3);
    Logger.warn(`Using mock schedule with ${numStudents} students and ${numTeachers} teachers`);

    const students = [];

    for (let i = 0; i < numStudents; i++) {
        students.push({
            id: `student-${i}`
        });
    }
    const teachers = [];
    for (let i = 0; i < numTeachers; i++) {
        teachers.push({
            id: `teacher-${i}`
        });
    }
    return {
        class_roster_students: students,
        class_roster_teachers: teachers
    };
}
