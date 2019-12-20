import winston = require("winston");

const logger: winston.Logger = winston.createLogger({
	level: "debug",
	format: winston.format.simple(),
	transports: [
		new winston.transports.File({ filename: "error.log", level: "error" }),
		new winston.transports.Console({ format: winston.format.simple() })
	]
});
export {logger};