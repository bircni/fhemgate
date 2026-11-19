// FHEM Platform Plugin for HomeBridge
// current version on https://github.com/justme-1968/homebridge
//
// Remember to add platform to config.json. Example:
// "platforms": [
//     {
//         "platform": "FHEM",
//         "name": "FHEM",
//         "ssl": true,
//         "auth": {"user": "fhem", "pass": "fhempassword"},
//         "server": "127.0.0.1",
//         "port": 8083,
//         "webname": fhem,
//         "jsFunctions": "myFunctions",
//         "filter": "room=xyz"
//     }
// ],
// @ts-nocheck -- the code taken over from homebridge-fhem. it shrinks as its parts move into typed modules.
import { createRequire } from 'node:module';
import util from 'node:util';
import events from 'node:events';

import { ct2rgb as FHEM_ct2rgb, hsv2rgb as FHEM_hsv2rgb, rgb2hex as FHEM_rgb2hex, rgb2hsv as FHEM_rgb2hsv, xyY2rgb as FHEM_xyY2rgb } from './util/color.ts';
import { sanitizeHapName } from './util/names.ts';
import { parseHomebridgeMapping } from './mapping/parser.ts';
import { reading2homekit as FHEM_reading2homekit } from './mapping/toHomekit.ts';
import { commandFor } from './mapping/toFhem.ts';
import { prepareMappings } from './mapping/compile.ts';
import { PluginState } from './state/pluginState.ts';
import { deviceIdentity } from './devices/identity.ts';
import { detectMappings, reviseMappings } from './devices/detect.ts';
import { hmccuChannel, hmccuDatapoint, hmccuMappings, hmccuReading, hmccuReadings, hmccuScalesLevel } from './devices/rules/hmccu.ts';
import { CustomUUIDs } from './accessory/customCharacteristics.ts';
import { FhemAccessory } from './accessory/accessory.ts';
import { execute, fetchDevices } from './fhem/client.ts';
import { startLongpoll } from './fhem/eventStream.ts';
import { handleDebugRequest, startDebugServer } from './debug/server.ts';

const require = createRequire(import.meta.url);

var version = require('../package.json').version;


var User;
var Accessory, Service, Characteristic, Units, Formats, Perms, UUIDGen, FakeGatoHistoryService;
export default function(homebridge){
  console.log('homebridge API version: ' + homebridge.version);
  console.info( 'this is homebridge-fhem '+ version );

//console.log( homebridge );
//process.exit(0);
  User = homebridge.user;

  state = new PluginState(homebridge.hap);

  //Accessory = homebridge.platformAccessory;
  Accessory = homebridge.hap.Accessory;
  Service = homebridge.hap.Service;
  Characteristic = homebridge.hap.Characteristic;
  UUIDGen = homebridge.hap.uuid;


  try {
    state.historyServiceClass = require('fakegato-history')(homebridge);
  } catch(e) {
    if (e.code !== 'MODULE_NOT_FOUND') {
      throw e;
    }

    console.log( 'error: fakegato-history not installed' );
  }

  homebridge.registerPlatform('homebridge-fhem', 'FHEM', FHEMPlatform);
}


// the readings and subscriptions of the running plugin. set when homebridge loads the plugin.
var state;
function FHEM_subscribe(accessory, informId, characteristic, mapping) { state.subscriptions.subscribe(accessory, informId, characteristic, mapping) }
function FHEM_unsubscribe(accessory, informId, characteristic) { state.subscriptions.unsubscribe(accessory, informId, characteristic) }
function FHEM_isPublished(device) { return state.subscriptions.publishedAccessory(device) }
function FHEM_update(informId, orig, no_update) { state.update(informId, orig, no_update) }

function FHEM_startLongpoll(connection) {
  startLongpoll(state, connection, function() { connection.fhem.checkAndSetGenericDeviceType() });
}

var FHEM_platforms = [];

function
FHEMPlatform(log, config, api) {
  events.EventEmitter.call(this);

  Units = api.hap.Units;
  Formats = api.hap.Formats;
  Perms = api.hap.Perms;

  this.log         = log;
  this.config      = config;

  if( api ) {
    this.api         = api;

    //this.api.on('didFinishLaunching', this.didFinishLaunching.bind(this));

    this.api.on('shutdown', this.shutdown.bind(this));
  }

  //this.server      = config['server'] || '127.0.0.1';
  this.server      = config['server'];
  this.port        = config['port'] || 8083;
  this.filter      = config['filter'];
  this.jsFunctions = config['jsFunctions'];

  this.scope        = config['scope'];

  if( this.server === undefined ) {
    log.error( 'incomplete configuration ' );
    return;
  }

  if( this.jsFunctions !== undefined ) {
    try {
      var path = this.jsFunctions;
      if( path.substr(0,1) != '/' )
        path = User.storagePath()+'/'+this.jsFunctions;
      this.jsFunctions = require(path);
    } catch(err) {
      log.error( '  jsFunctions: ' + err );
      delete this.jsFunctions;
    }
  }

  var base_url = 'http://';
  if( config.ssl ) {
    if( typeof config.ssl !== 'boolean' ) {
      this.log.error( 'config: value for ssl has to be boolean.' );
      process.exit(0);
    }
    base_url = 'https://';
  }
  base_url += this.server + ':' + this.port;

  if( config.webname ) {
    base_url += '/'+config.webname;
  } else {
    base_url += '/fhem';
  }

  this.connection = { base_url: base_url, auth: config['auth'], log: log, fhem: this, neverTimeout: config['neverTimeout'] };

  FHEM_platforms.push(this);

  FHEM_startLongpoll( this.connection );
}
util.inherits(FHEMPlatform, events.EventEmitter);

function
FHEM_sortByKey(array, key) {
  return array.sort( function(a, b) {
    var x = a[key]; var y = b[key];
    return ((x < y) ? -1 : ((x > y) ? 1 : 0));
    });
}

function FHEM_execute(log, connection, cmd, callback) {
  execute(state, log, connection, cmd, callback);
}

FHEMPlatform.prototype = {
  didFinishLaunching: function() { this.log.error('didFinishLaunching')
  },

  shutdown: function() { //this.log.error('shutdown')
    for( var informId in state.subscriptions.byInformId ) {
      for( var subscription of state.subscriptions.byInformId[informId] ) {
        var accessory = subscription.accessory;
        if( accessory.shutdown ) continue;

        if( accessory.historyService )
          accessory.historyService.save();

        accessory.shutdown = true;
      }
    }
  },

  execute: function(cmd,callback) {FHEM_execute(this.log, this.connection, cmd, callback)},

  checkAndSetGenericDeviceType: function() {
    this.log('Checking devices and attributes...');

    var cmd = '{AttrVal("global","userattr","")}';
    this.execute( cmd,
                  function(result) {
                    //if( result === undefined )
                      //result = '';

                    if( !result.match(/(^| )homebridgeMapping\b/) ) {
                      var cmd = '{ addToAttrList( "homebridgeMapping:textField-long" ) }';
                      this.execute( cmd );
                      this.log.info( 'homebridgeMapping attribute created.' );
                    }

                    if( !result.match(/(^| )genericDeviceType\b/) ) {
                      var cmd = '{addToAttrList( "genericDeviceType:security,ignore,switch,outlet,light,blind,thermometer,thermostat,contact,garage,window,lock" ) }';
                      this.execute( cmd,
                                    function(result) {
                                        this.log.warn( 'genericDeviceType attribute was not known. please restart.' );
					if( state.csrfToken[this.connection.base_url] )
                                          process.exit(0);
                                    }.bind(this) );
                    }

                  }.bind(this) );

    if( !this.siri_device );
      this.execute( 'jsonlist2 TYPE=siri',
                    function(result) {
                      try {
                        var d = JSON.parse( result );
                        if( d.totalResultsReturned === 1 ) {
                          this.siri_device = d.Results[0].Name;
                          this.log.info( 'siri device is ' + this.siri_device );
                          this.execute( '{$defs{'+ this.siri_device +'}->{"homebridge-fhem version"} = "'+ version +'"}' );
                        } else
                          this.log.warn( 'no siri device found. please define it.' );

                      } catch(err) {
                        this.log.error( 'failed to parse ' + result );
                      }
                    }.bind(this) );
  },

  accessories: function(callback) {
    var foundAccessories = [];

    //this.checkAndSetGenericDeviceType();
    if( !this.connection ) {
      callback(foundAccessories);
      return;
    }

    // mechanism to ensure callback is only executed once all requests complete
    var asyncCalls = 0;
    function callbackLater() { if (--asyncCalls == 0) callback(foundAccessories); }

    if( state.csrfToken[this.connection.base_url] === undefined ) {
      if( this.connection.dead ) {
        callback(foundAccessories);
	return;
      }

      var timeout = 500;
      if( state.longpoll[this.connection.base_url].disconnects )
        timeout = state.longpoll[this.connection.base_url].disconnects * 1000;
      this.log.debug('FHEM csrfToken missing, retry in: ' + timeout + 'msec');
      setTimeout( function(){this.connection.fhem.accessories(callback)}.bind(this), timeout  );
      return;
    }

    this.log.info('Fetching FHEM devices...');

    asyncCalls++;

    fetchDevices( state, this.log, this.connection, this.filter,
                 function(err, response, json) {
                   if( !err && response.statusCode == 200 && json ) {
//console.log("got json: " + util.inspect(json) );
                     this.log.info( 'got: ' + json['totalResultsReturned'] + ' results' );
                     if( json['totalResultsReturned'] ) {
                       var sArray=FHEM_sortByKey(json['Results'],'Name');
                       sArray.map( function(s) {

                         //FIXME: change to factory pattern
                         var accessory = new FHEMAccessory(this, s);
                         if( accessory && accessory.service_name ) {
                           accessory.fhem = this.connection.fhem;

                           if( !accessory.isInScope('siri') ) {
                             this.log.info( 'ignoring '+ accessory.name +' for siri' );
                             return;
                           }

                           foundAccessories.push(accessory);
                         } else {
                           this.log.info( 'no accessory created for ' + s.Internals.NAME + ' (' + s.Internals.TYPE + ')' );
                           return undefined;
                         }

                       }.bind(this) );
                     }

                     callback(foundAccessories);
                     //callbackLater();

                   } else {
                     this.log.error('There was a problem connecting to FHEM');
                     if( response )
                       this.log.error( '  ' + response.statusCode + ': ' + response.statusMessage );

                   }

                 }.bind(this) );
  }
}

class FHEMAccessory extends FhemAccessory {
  constructor(platform, s) {
    super(platform, s, state, FHEM_execute);
  }
}


//http server for debugging
function FHEMdebug_handleRequest(request, response){
  handleDebugRequest(request, response, state, state.longpoll);
}

// the tests load this file many times in parallel and switch the server off
if( process.env.FHEM2HB_DEBUG_SERVER !== 'off' )
  startDebugServer( FHEMdebug_handleRequest );

// the plugin does not export its internals. the tests reach them through this.
export const __internals = {
  useHap: function(hap) {
    Accessory = hap.Accessory; Service = hap.Service; Characteristic = hap.Characteristic; UUIDGen = hap.uuid;
    Units = hap.Units; Formats = hap.Formats; Perms = hap.Perms;
    state = new PluginState(hap);
    return state;
  },
  useUser: function(user) { User = user },
  useFakeGato: function(service) { state.historyServiceClass = service },

  FHEMPlatform: FHEMPlatform,
  FHEMAccessory: FHEMAccessory,

  FHEM_platforms: FHEM_platforms,

  FHEM_subscribe: FHEM_subscribe,
  FHEM_unsubscribe: FHEM_unsubscribe,
  FHEM_isPublished: FHEM_isPublished,
  FHEM_update: FHEM_update,
  FHEM_reading2homekit: FHEM_reading2homekit,
  FHEM_startLongpoll: FHEM_startLongpoll,
  FHEM_execute: FHEM_execute,

  FHEM_sortByKey: FHEM_sortByKey,
  FHEM_rgb2hex: FHEM_rgb2hex,
  FHEM_hsv2rgb: FHEM_hsv2rgb,
  FHEM_ct2rgb: FHEM_ct2rgb,
  FHEM_xyY2rgb: FHEM_xyY2rgb,
  FHEM_rgb2hsv: FHEM_rgb2hsv,

  CustomUUIDs: CustomUUIDs,
  sanitizeHapName: sanitizeHapName,

  FHEM_hmccuReadings: hmccuReadings,
  FHEM_hmccuChannel: hmccuChannel,
  FHEM_hmccuReading: hmccuReading,
  FHEM_hmccuDatapoint: hmccuDatapoint,
  FHEM_hmccuScalesLevel: hmccuScalesLevel,
  FHEM_hmccuMappings: hmccuMappings,

  FHEMdebug_handleRequest: FHEMdebug_handleRequest,
};
