import {createLogger, format, transports} from "winston";
import winstonEnricher from "@newrelic/winston-enricher";
import dotenv from "dotenv";

const logFormat = format.printf(({ level, message, label, timestamp }) => {
    return `${timestamp} [${level}]: ${message} service: ${label}`;
});

const devOutput = [ format.colorize(), format.timestamp(), format.label({ label: "default" }), logFormat];
const nrOutput = [ format.timestamp(), format.label({ label: "default" }), winstonEnricher() ];

export const Logger = registerLogger();

export function registerLogger(service = "default") {
    dotenv.config();
    return createLogger(
        {
            level: process.env.LOG_LEVEL ?? "info",
            format: format.combine(
                ...(process.env.NEW_RELIC_LICENSE_KEY
                    ? nrOutput
                    : devOutput)
            ),
            defaultMeta: { service },
            transports: [
                new transports.Console(
                    {
                        level: process.env.LOG_LEVEL ?? "info",
                    }
                ),
                new transports.File(
                    {
                        level: process.env.LOG_LEVEL ?? "info",
                        filename: `logs/sfu_${new Date().toLocaleDateString("en", {
                            year: "numeric",
                            day: "2-digit",
                            month: "2-digit",
                            hour: "2-digit",
                            minute: "2-digit"
                        })
                            .replace(/,/g, "")
                            .replace(/\//g, "-")
                            .replace(/ /g, "_")
                        }.log`
                    }
                )
            ]
        }
    );
}
