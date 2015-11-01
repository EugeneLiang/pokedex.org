require('regenerator/runtime');

var zpad = require('zpad');
var find = require('lodash/collection/find');
var pick = require('lodash/object/pick');

var PouchDB = require('pouchdb');
PouchDB.plugin(require('pouchdb-upsert'));
PouchDB.plugin(require('pouchdb-load'));
PouchDB.plugin(require('transform-pouch'));
var inMemoryDB = require('./inMemoryDatabase');
var Stopwatch = require('../shared/stopwatch');

var localMonstersDB;
var remoteMonstersDB;
var localDescriptionsDB;
var remoteDescriptionsDB;

async function checkReplicated(db) {
  if (db.__initialLoadComplete) {
    return true;
  }
  try {
    await db.get('_local/initialLoadComplete');
    db.__initialLoadComplete = true;
    return true;
  } catch (ignored) {
    return false;
  }
}

async function markReplicated(db) {
  db.__initialLoadComplete = true;
  return await db.putIfNotExists({
    _id: '_local/initialLoadComplete'
  });
}

async function replicateDB(db, filename) {
  var alreadyDone = await checkReplicated(db);
  if (alreadyDone) {
    console.log(`${filename}: replication already done`);
    return;
  }

  console.log(`${filename}: started replication`);
  await db.load(filename);
  console.log(`${filename}: done replicating`);
  await markReplicated(db);
}

async function replicateMonsters() {
  return await replicateDB(localMonstersDB, '../assets/monsters.txt');
}

async function replicateDescriptions() {
  return await replicateDB(localDescriptionsDB, '../assets/descriptions.txt');
}

async function initDBs(couchHome) {
  remoteMonstersDB = new PouchDB(couchHome + '/monsters');
  remoteDescriptionsDB = new PouchDB(couchHome + '/descriptions');
  localDescriptionsDB = new PouchDB('descriptions');
  localMonstersDB = new PouchDB('monsters');
  // make the local monster doc smaller
  localMonstersDB.transform({
    incoming: doc => {
      doc = pick(doc, '_id', '_rev', '_revisions', 'descriptions',
        'types', 'attack', 'defense', 'speed', 'sp_atk', 'sp_def', 'hp',
        'weight', 'height', 'national_id', 'name', 'male_female_ratio');
      doc.descriptions = doc.descriptions.filter(x => /_gen_5$/.test(x.name));
      return doc;
    }
  });
  if (localMonstersDB.adapter) {
    await replicateMonsters();
    await replicateDescriptions();
  } else {
    console.log(
      'this browser doesn\'t support worker IDB. cannot work offline.');
  }
}

async function getMonstersDB() {
  if (await checkReplicated(localMonstersDB)) {
    return localMonstersDB;
  }
  return remoteMonstersDB;
}

async function getDescriptionsDB() {
  if (await checkReplicated(localDescriptionsDB)) {
    return localDescriptionsDB;
  }
  return remoteDescriptionsDB;
}

module.exports = {
  init: (origin) => {
    var couchHome = origin.replace(/:[^:]+$/, ':6984');
    initDBs(couchHome);
  },
  getFullMonsterDataById: async nationalId => {
    var stopwatch = new Stopwatch();
    var nationalDocId = zpad(nationalId, 5);
    var monster = await (await getMonstersDB()).get(nationalDocId);
    stopwatch.time('get() monster');
    // get a generation-5 description
    var desc = find(monster.descriptions, x => /_gen_5$/.test(x.name));
    var descId = desc.resource_uri.match(/\/(\d+)\/$/)[1];
    var descDocId = zpad(parseInt(descId, 10), 7);
    var description = await (await getDescriptionsDB()).get(descDocId);
    stopwatch.time('get() descriptions');
    return {monster, description};
  },
  getFilteredMonsters: async (filter) => {
    return inMemoryDB.findByNamePrefix(filter);
  },
  getInitialMonsters: () => {
    return inMemoryDB.findAll();
  }
};