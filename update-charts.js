var fs=require('fs');
var jf=fs.readdirSync('wiki/tiddlers/system').find(f=>f.includes('health-buff'));
var plugin=JSON.parse(fs.readFileSync('wiki/tiddlers/system/'+jf,'utf8'));
var tiddlers=JSON.parse(plugin.text).tiddlers;

var miniChart = fs.readFileSync('src/health-buff-debuff-tracker/ViewTemplate/MedicineCheckinMiniChart.tid','utf8');
tiddlers['$:/plugins/linonetwo/health-buff-debuff-tracker/ViewTemplate/MedicineCheckinMiniChart'] = {
  title: '$:/plugins/linonetwo/health-buff-debuff-tracker/ViewTemplate/MedicineCheckinMiniChart',
  text: miniChart.split('\n\n').slice(1).join('\n\n')
};
var bodyChart = fs.readFileSync('src/health-buff-debuff-tracker/ViewTemplate/MedicineBodyChart.tid','utf8');
tiddlers['$:/plugins/linonetwo/health-buff-debuff-tracker/ViewTemplate/MedicineBodyChart'] = {
  title: '$:/plugins/linonetwo/health-buff-debuff-tracker/ViewTemplate/MedicineBodyChart',
  text: bodyChart.split('\n\n').slice(1).join('\n\n')
};
plugin.text=JSON.stringify({tiddlers:tiddlers});
fs.writeFileSync('wiki/tiddlers/system/'+jf,JSON.stringify(plugin));
console.log('Updated charts');
