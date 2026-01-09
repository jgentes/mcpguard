import pino from 'pino';
import pinoPrettyModule from 'pino-pretty';
const pinoPretty = pinoPrettyModule;
const isCLIMode = process.argv[1]?.includes('cli') || process.env.CLI_MODE === 'true';
const isTestEnv = process.env.NODE_ENV === 'test' ||
    process.env.VITEST === 'true' ||
    process.argv[1]?.includes('vitest');
const defaultLevel = isTestEnv ? 'silent' : isCLIMode ? 'warn' : 'info';
const isDevMode = process.env.NODE_ENV !== 'production' && !isTestEnv;
const loggerConfig = {
    level: process.env.LOG_LEVEL || defaultLevel,
};
const isTTY = process.stderr.isTTY === true;
let logger;
if (isDevMode) {
    logger = pino(loggerConfig, pinoPretty({
        destination: process.stderr,
        colorize: isTTY,
        translateTime: 'HH:MM:ss.l',
        ignore: 'pid,hostname',
    }));
}
else {
    logger = pino(loggerConfig, process.stderr);
}
export default logger;
//# sourceMappingURL=logger.js.map