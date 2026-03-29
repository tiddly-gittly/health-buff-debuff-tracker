var fs = require('fs');
var path = require('path');

function parseTid(content) {
  // Strip UTF-8 BOM if present
  if (content.charCodeAt(0) === 0xFEFF) content = content.slice(1);
  var lines = content.split('\n');
  var fields = {};
  var i = 0;
  while (i < lines.length && lines[i].trim() !== '') {
    var m = lines[i].match(/^(\S+):\s*(.*)/);
    if (m) fields[m[1]] = m[2].trim();
    i++;
  }
  i++;
  fields.text = lines.slice(i).join('\n');
  return fields;
}

var jf = fs.readdirSync('wiki/tiddlers/system').find(function(f) { return f.includes('health-buff'); });
var plugin = JSON.parse(fs.readFileSync('wiki/tiddlers/system/' + jf, 'utf8'));
var tiddlers = JSON.parse(plugin.text).tiddlers;

// Update MedicineCheckinPanel
var panel = parseTid(fs.readFileSync('src/health-buff-debuff-tracker/components/MedicineCheckinPanel.tid', 'utf8'));
tiddlers[panel.title] = panel;
console.log('Updated panel: ' + panel.title);

// Update CSS
var cssTitle = '$:/plugins/linonetwo/health-buff-debuff-tracker/PageLayout/style.css';
tiddlers[cssTitle].text = fs.readFileSync('src/health-buff-debuff-tracker/PageLayout/style.css', 'utf8');
console.log('Updated CSS');

plugin.text = JSON.stringify({tiddlers: tiddlers});
fs.writeFileSync('wiki/tiddlers/system/' + jf, JSON.stringify(plugin));
console.log('Done - saved ' + jf);


var jf = fs.readdirSync('wiki/tiddlers/system').find(function(f) { return f.includes('health-buff'); });
var plugin = JSON.parse(fs.readFileSync('wiki/tiddlers/system/' + jf, 'utf8'));
var tiddlers = JSON.parse(plugin.text).tiddlers;

// Update MedicineCheckinPanel
var panel = parseTid(fs.readFileSync('src/health-buff-debuff-tracker/components/MedicineCheckinPanel.tid', 'utf8'));
tiddlers[panel.title] = panel;
console.log('Updated panel: ' + panel.title);

// Update CSS
var cssTitle = '$:/plugins/linonetwo/health-buff-debuff-tracker/PageLayout/style.css';
tiddlers[cssTitle].text = fs.readFileSync('src/health-buff-debuff-tracker/PageLayout/style.css', 'utf8');
console.log('Updated CSS');

plugin.text = JSON.stringify({tiddlers: tiddlers});
fs.writeFileSync('wiki/tiddlers/system/' + jf, JSON.stringify(plugin));
console.log('Done - saved ' + jf);
