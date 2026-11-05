"use strict";
const activityevents = require("$:/plugins/linonetwo/activity-log-tools/filter/activityevents.js").activityevents;
const logPrefix = "$:/plugins/linonetwo/health-buff-debuff-tracker/medicine-checkin-log/";

exports.medicinecheckinevents = function(source, operator, options) {
  const result = [];
  source((medicine, title) => {
    const logTitle = logPrefix + title;
    const logSource = callback => callback(options.wiki.getTiddler(logTitle), logTitle);
    for (const record of activityevents(logSource, operator, options)) {
      if (operator.suffix === "titles" || operator.suffix === "timestamps") result.push(record);
      else {
        const event = JSON.parse(record);
        event.extendedProps.activityLabel = medicine?.fields.caption || title;
        result.push(JSON.stringify(event));
      }
    }
  });
  return result;
};
