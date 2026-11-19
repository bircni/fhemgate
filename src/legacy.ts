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
import http from 'node:http';

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

  //Accessory = homebridge.platformAccessory;
  Accessory = homebridge.hap.Accessory;
  Service = homebridge.hap.Service;
  Characteristic = homebridge.hap.Characteristic;
  UUIDGen = homebridge.hap.uuid;

  state = new PluginState(homebridge.hap);

  try {
    FakeGatoHistoryService = require('fakegato-history')(homebridge);
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

var FHEM_longpoll = {};
var FHEM_csrfToken = {};
//FIXME: add filter
function FHEM_startLongpoll(connection) {
  if( !FHEM_longpoll[connection.base_url] ) {
    FHEM_longpoll[connection.base_url] = {};
    FHEM_longpoll[connection.base_url].connects = 0;
    FHEM_longpoll[connection.base_url].disconnects = 0;
    FHEM_longpoll[connection.base_url].received_total = 0;
  }

  if( FHEM_longpoll[connection.base_url].connected )
    return;
  FHEM_longpoll[connection.base_url].connects++;
  FHEM_longpoll[connection.base_url].received = 0;
  FHEM_longpoll[connection.base_url].connected = true;


  var filter = '.*';
  var since = 'null';
  if( FHEM_longpoll[connection.base_url].last_event_time )
    since = FHEM_longpoll[connection.base_url].last_event_time/1000;
  var query = '?XHR=1'
              + '&inform=type=status;addglobal=1;filter='+filter+';since='+since+';fmt=JSON'
              + '&timestamp='+Date.now();

  var url = encodeURI( connection.base_url + query );
  console.log( 'starting longpoll: ' + url );

  var FHEM_longpollOffset = 0;
  var input = '';
  connection.request.get( { url: url } ).on( 'data', function(data) {
//console.log( 'data: ' + data );
               if( !data )
                 return;

               var length = data.length;
               FHEM_longpoll[connection.base_url].received += length;
               FHEM_longpoll[connection.base_url].received_total += length;

               input += data;

               try {
                 var lastEventTime = Date.now();
                 for(;;) {
                   var nOff = input.indexOf('\n', FHEM_longpollOffset);
                   if(nOff < 0)
                     break;
                   var l = input.substr(FHEM_longpollOffset, nOff-FHEM_longpollOffset);
                   FHEM_longpollOffset = nOff+1;
//console.log( 'Rcvd: ' + (l.length>132 ? l.substring(0,132)+'...('+l.length+')':l) );

                   if(!l.length)
                     continue;

                   var d;
                   if( l.substr(0,1) == '[' ) {
                     try {
                       d = JSON.parse(l);
                     } catch(err) {
                       console.log( '  longpoll JSON.parse: ' + err );
                       continue;
                     }
                   } else
                     d = l.split('<<', 3);
//console.log(d);

                   if(d.length != 3)
                     continue;
                   if(d[0].match(/-ts$/))
                     continue;
                   if(d[0].match(/^#FHEMWEB:/))
                     continue;

                   var match = d[0].match(/([^-]*)-(.*)/);
                   if( !match )
                     continue;
                   var device = match[1];
                   var reading = match[2];
//console.log( 'device: ' + device );
//console.log( 'reading: ' + reading );
                   if( reading === undefined )
                     continue;

                   var value = d[1];
//console.log( 'value: ' + value );
                   if( value.match( /^set-/ ) )
                     continue;


                   if( 0 && device == 'global' ) {
                     if( reading == 'DEFINED' ) {
console.log( 'DEFINED: ' + value );
console.log( connection.base_url );
                       FHEM_platforms.forEach( function(platform) {
platform.log( platform.connection.base_url );
                         if( connection.base_url == platform.connection.base_url ) {
platform.log( platform.filter );
                           platform.accessories( function(accessories) {
                                                   accessories.forEach( function(accessory) {
                                                     if( platform.addBridgedAccessory )
                                                       platform.addBridgedAccessory(accessory);

                                                   } );
                                                } );
                         }
                       } );

                     } else if( reading == 'DELETED' ) {
console.log( 'DELETED: ' + value );
                       var accessory = FHEM_isPublished(value);

                       //if( accessory && typeof accessory.updateReachability === 'function' )
                         //accessory.updateReachability( false );

                     } else if( reading == 'ATTR' ) {
console.log( 'ATTR: ' + value );
                       var values = value.split( ' ' );
                       var accessory = FHEM_isPublished(values[0]);

                       if( accessory && values[1] == 'disable' )
                         FHEM_update(values[0] + '-reachable', !values[2] );
                       else if( values[1] == 'genericDeviceType' || values[1] =='homebridgeMapping' ) {
console.log( connection.base_url );
                         FHEM_platforms.forEach( function(platform) {
platform.log( platform.connection.base_url );
                           if( connection.base_url == platform.connection.base_url ) {
platform.log( platform.filter );
                             platform.accessories( function(accessories) {
                                                     accessories.forEach( function(accessory) {
                                                       if( platform.addBridgedAccessory )
                                                         platform.addBridgedAccessory(accessory);

                                                     } );
                                                  } );
                           }
                         } );
                       }

                     } else if( reading == 'DELETEATTR' ) {
console.log( 'DELETEATTR: ' + value );
                       var values = value.split( ' ' );
                       var accessory = FHEM_isPublished(values[0]);

                       if( accessory && values[1] == 'disable' )
                         FHEM_update(values[0] + '-reachable', !values[2] );

                     }

                     continue;
                   }

                   var subscriptions = state.subscriptions.byInformId[d[0]];
                   if( subscriptions ) {
                     FHEM_update( d[0], value );
                     FHEM_longpoll[connection.base_url].last_event_time = lastEventTime;

                     subscriptions.forEach( function(subscription) {
                       var accessory = subscription.accessory;

                       if(accessory.mappings.colormode) {
                         if( reading == 'xy') {
                           var xy = value.split(',');
                           var rgb = FHEM_xyY2rgb(xy[0], xy[1] , 1);
                           var hsv = FHEM_rgb2hsv(rgb);

                           FHEM_update( device+'-h', hsv[0] );
                           FHEM_update( device+'-s', hsv[1] );
                           FHEM_update( device+'-v', hsv[2] );

                           FHEM_update( device+'-'+reading, value, false );

                           return;

                         } else if( reading == 'ct') {
                           var rgb = FHEM_ct2rgb(value);
                           var hsv = FHEM_rgb2hsv(rgb);

                           FHEM_update( device+'-h', hsv[0] );
                           FHEM_update( device+'-s', hsv[1] );
                           FHEM_update( device+'-v', hsv[2] );

                           FHEM_update( device+'-'+reading, value, false );

                           return;
                         }

                       }
                     } );

                   }
                 }

             } catch(err) {
               connection.log.error( '  error in longpoll connection: ' + err );

             }

             input = input.substr(FHEM_longpollOffset);
             FHEM_longpollOffset = 0;

	     if( FHEM_csrfToken[connection.base_url] )
               FHEM_longpoll[connection.base_url].disconnects = 0;

           } ).on( 'response', function(response) {
             if( response.headers && response.headers['x-fhem-csrftoken'] )
               FHEM_csrfToken[connection.base_url] = response.headers['x-fhem-csrftoken'];
             else
               FHEM_csrfToken[connection.base_url] = '';

             connection.fhem.checkAndSetGenericDeviceType();

           } ).on( 'end', function() {
             FHEM_longpoll[connection.base_url].connected = false;

             FHEM_longpoll[connection.base_url].disconnects++;
             var timeout = 500 * FHEM_longpoll[connection.base_url].disconnects - 300;
             if( timeout > 30000 ) timeout = 30000;

             connection.log.error( 'longpoll ended, reconnect in: ' + timeout + 'msec' );
             setTimeout( function(){FHEM_startLongpoll(connection)}, timeout  );

           } ).on( 'error', function(err) {
             FHEM_longpoll[connection.base_url].connected = false;

             FHEM_longpoll[connection.base_url].disconnects++;
             var timeout = 3000 * FHEM_longpoll[connection.base_url].disconnects;
             if( timeout > 30000 ) timeout = 30000;

             if( !connection.neverTimeout && timeout > 10000 && !FHEM_csrfToken[connection.base_url] ) {
               connection.log.error( 'longpoll error: ' + err + ', retrys exhausted' );
	       connection.dead = true;
	       return;
             }

             connection.log.error( 'longpoll error: ' + err + ', retry in: ' + timeout + 'msec' );
             setTimeout( function(){FHEM_startLongpoll(connection)}, timeout );

           } );
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

  var request = require('postman-request');
  var auth = config['auth'];
  if( auth ) {
    if( auth.sendImmediately === undefined )
      auth.sendImmediately = false;

    request = request.defaults( { auth: auth, rejectUnauthorized: false } );
  }

  this.connection = { base_url: base_url, request: request, log: log, fhem: this, neverTimeout: config['neverTimeout'] };

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

function
FHEM_execute(log,connection,cmd,callback) {
  if( FHEM_csrfToken[connection.base_url] )
    cmd += '&fwcsrf='+FHEM_csrfToken[connection.base_url];
  cmd += '&XHR=1';
  var url = encodeURI( connection.base_url + '?cmd=' + cmd );
  log.info( '  executing: ' + url );

  connection.request
              .get( { url: url, gzip: true },
               function(err, response, result) {
                      if( !err && response.statusCode == 200 ) {
                        result = result.replace(/[\r\n]/g, '');
                        if( callback )
                          callback( result );

                      } else {
                        log('There was a problem connecting to FHEM ('+ url +').');
                        if( response )
                          log( '  ' + response.statusCode + ': ' + response.statusMessage );

                      }

                    } )
              .on( 'error', function(err) { log('There was a problem connecting to FHEM ('+ url +'):'+ err); } );
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
					if( FHEM_csrfToken[this.connection.base_url] )
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

    if( FHEM_csrfToken[this.connection.base_url] === undefined ) {
      if( this.connection.dead ) {
        callback(foundAccessories);
	return;
      }

      var timeout = 500;
      if( FHEM_longpoll[this.connection.base_url].disconnects )
        timeout = FHEM_longpoll[this.connection.base_url].disconnects * 1000;
      this.log.debug('FHEM csrfToken missing, retry in: ' + timeout + 'msec');
      setTimeout( function(){this.connection.fhem.accessories(callback)}.bind(this), timeout  );
      return;
    }

    this.log.info('Fetching FHEM devices...');

    var cmd = 'jsonlist2';
    if( this.filter )
      cmd += '%20' + encodeURIComponent(this.filter);
    if( FHEM_csrfToken[this.connection.base_url] )
      cmd += '&fwcsrf='+FHEM_csrfToken[this.connection.base_url];
    var url = this.connection.base_url + '?cmd=' + cmd + '&XHR=1';
    this.log.info( 'fetching: ' + url );

    asyncCalls++;

    this.connection.request.get( { url: url, json: true, gzip: true },
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

function
FHEMAccessory(platform, s) {
  this.log         = platform.log;
  this.connection  = platform.connection;
  this.jsFunctions = platform.jsFunctions;

  if( FHEM_isPublished(s.Internals.NAME) ) {
    this.log.warn( s.Internals.NAME + ' is already published');
    return;
  }

  if( !s.Readings ) {
    this.log.error( 'ignoring ' + s.Internals.NAME + ' (' + s.Internals.TYPE + ') without readings' );
    return;
  }
  if( !s.Attributes ) {
    this.log.error( 'ignoring ' + s.Internals.NAME + ' (' + s.Internals.TYPE + ') without attributes' );
    return;
  }


  if( s.Attributes.disable == 1 ) {
    this.log.info( s.Internals.NAME + ' is disabled');
    //return;
  }

  if( !detectMappings(this, s, state) )
    return;

  this.fromHomebridgeMapping( s.Attributes.homebridgeMapping );
  this.log.debug( 'mappings for ' + s.Internals.NAME + ': '+ util.inspect(this.mappings) );

  this.log( s.Internals.NAME + ' is ' + this.service_name );

  reviseMappings(this, s);

  this.log( s.Internals.NAME + ' has' );
  for( var characteristic_type in this.mappings ) {
    var mappings = this.mappings[characteristic_type];
    if( !Array.isArray(mappings) )
       mappings = [mappings];

    for( var mapping of mappings ) {
      if( characteristic_type == 'On' )
        this.log( '  ' + characteristic_type + ' [' + (mapping.device ? mapping.device +'.':'') + mapping.reading + ';' + mapping.cmdOn +',' + mapping.cmdOff + ']' );
      else if( characteristic_type == 'Hue' || characteristic_type == 'Saturation' )
        this.log( '  ' + characteristic_type + ' [' + (mapping.device ? mapping.device +'.':'') + mapping.reading + ';' + mapping.cmd + ';0-' + mapping.max +']' );
      else if( characteristic_type == 'history' )
        this.log( '  ' + characteristic_type + ' [' + (mapping.type ? mapping.type:'thermo') +';'+ (mapping.size ? mapping.size:1024) + ']' );
      else if( mapping.name ) {
        if( characteristic_type == CustomUUIDs.Volume )
          this.log( '  Custom ' + mapping.name + ' [' + (mapping.device ? mapping.device +'.':'') + mapping.reading +  ';' + (mapping.nocache ? 'not cached' : 'cached' )  +']' );
        else
          this.log( '  Custom ' + mapping.name + ' [' + (mapping.device ? mapping.device +'.':'') + mapping.reading + ']' );
      } else
        this.log( '  ' + characteristic_type + ' [' + (mapping.device ? mapping.device +'.':'') + mapping.reading + ']' );
    }
  }

//log( util.inspect(s) );

  Object.assign(this, deviceIdentity(s, this.mappings));

  prepareMappings(this, s, { characteristics: Characteristic, cached: state.cache.values, update: FHEM_update, reading2homekit: FHEM_reading2homekit });
}

FHEMAccessory.prototype = {
  subscribe: function(mapping, characteristic) {
    if( typeof mapping === 'object' ) {
      mapping.characteristic = characteristic;

      if( characteristic )
        characteristic.FHEM_mapping = mapping;

      FHEM_subscribe(this, mapping.informId, characteristic, mapping);

    } else {
      FHEM_subscribe(this, mapping, characteristic);

    }
  },
  unsubscribe: function(mapping, characteristic) {
    if( mapping === undefined ) {
      for( var characteristic_type in this.mappings ) {
        var mapping = this.mappings[characteristic_type];
        FHEM_unsubscribe(this, mapping.informId, characteristic);
      }

    } else if( typeof mapping === 'object' ) {
      mapping.characteristic = characteristic;

      if( characteristic )
        characteristic.FHEM_mapping = mapping;

      FHEM_unsubscribe(this, mapping.informId, characteristic);

    } else {
      FHEM_unsubscribe(this, mapping, characteristic);

    }
  },

  fromHomebridgeMapping: function(homebridgeMapping) {
    parseHomebridgeMapping(this, homebridgeMapping, Accessory.Categories);
  },

  delayed: function(mapping,value,delay) {
    if( !this.delayed_timers )
      this.delayed_timers = {};

    if( typeof delay !== 'number' )
      delay = 1000;
    if( delay < 500 )
      delay = 500;

    var timer = this.delayed_timers[mapping.informId];
    if( timer ) {
      //this.log(this.name + ' delayed: removing old command ' + mapping.characteristic_type);
      clearTimeout( timer );
    }

    this.log.info(this.name + ' delaying command ' + mapping.characteristic_type + ' with value ' + value);
    this.delayed_timers[mapping.informId] = setTimeout( function(){
        delete this.delayed_timers[mapping.informId];
        this.command(mapping,value);
      }.bind(this), delay );
  },

  command: function(mapping,value) {
    var command = commandFor(this, mapping, value);
    if( command === undefined )
      return;

    this.execute(command);
  },

  execute: function(cmd,callback) {FHEM_execute(this.log, this.connection, cmd, callback)},

  query: function(mapping, callback) {
    var device = this.device;
    var reading;

    if( typeof mapping === 'object' ) {
      if( mapping.device )
        device = mapping.device;
      if( mapping.reading )
        reading = mapping.reading;

    } else
      reading = mapping;

    if( reading === undefined && mapping.default === undefined ) {
      if( callback !== undefined )
        callback( 1 );
      return;
    }

    this.log.info('query: ' + (mapping.name?mapping.name:mapping.characteristic_type) + ' for ' + mapping.informId);
    var value = mapping.cached;
    if( typeof mapping === 'object' && value !== undefined && (!('nocache' in mapping)) ) {
      var defined = undefined;
      if( mapping.homekit2name !== undefined ) {
        defined = mapping.homekit2name[value];
        if( defined === undefined )
          defined = '???';
      }

      mapping.log.info('  cached: ' + value + ' (as '+typeof(value) + (defined?'; means '+defined:'') + ')');

      if( callback !== undefined )
        callback( undefined, value );
      return value;

    } else {
      /*this.log.info('not cached; query: ' + mapping.informId);

      var value = state.cache.values[mapping.informId];
      value = FHEM_reading2homekit(mapping, value);

      if( value !== undefined ) {
        this.log.info('  cached: ' + value);
        if( callback !== undefined )
          callback( undefined, value );
        return value;

      } else*/
        this.log.info('  not cached' );
    }

    var cmd = '{ReadingsVal("'+device+'","'+reading+'","")}';

    this.execute( cmd,
                  function(result) {
                    var value = result.replace(/[\r\n]/g, '');
                    this.log.info('  value: ' + value);

                    if( value === undefined )
                      return value;

                    FHEM_update( mapping.informId, value, true );

                    if( callback !== undefined ) {
                      if( value === undefined )
                        callback(1);
                      else {
                        value = FHEM_reading2homekit(mapping, value);
                        if( value === undefined )
                          callback(1);
                        else
                          callback(undefined, value);
                      }                    
                    }
                    return value ;

                }.bind(this) );
  },

  isInRoom: function(room) {
    if( !room ) return false;
    if( !this.room ) return false;
    if( this.room.toLowerCase() === room ) return true;
    if( this.room.toLowerCase().match( '(^|,)('+room+')(,|\$)' ) ) return true;
    return false;
  },

  isOfType: function(type) {
    if( !type ) return false;
    if( this.service_name === type ) return true;
    return false;
  },

  isInScope: function(scope) {
    if( this.fhem === undefined ) return true;
    if( this.fhem.scope === undefined ) return true;

    if( typeof this.fhem.scope === 'object' ) {
      if( this.fhem.scope.grep(scope) != -1 ) return true;
    } else if( this.fhem.scope !== undefined ) {
      if( this.fhem.scope.match( '(^|,)('+scope+')(,|\$)' ) ) return true;
    }

    return false;
  },


  // for homebridge
  serviceOfName: function(service_name,subtype) {
    var serviceNameOfGenericDeviceType = {      ignore: null,
                                              security: 'SecuritySystem',
                                                switch: 'Switch',
                                                outlet: 'Outlet',
                                                 light: 'Lightbulb',
                                                 blind: 'WindowCovering',
                                               contact: 'ContactSensor',
                                           thermometer: 'TemperatureSensor',
                                            thermostat: 'Thermostat',
                                                garage: 'GarageDoorOpener',
                                                window: 'Window',
                                                  lock: 'LockMechanism'
                                         };

    if( serviceNameOfGenericDeviceType[service_name] !== undefined )
      service_name = serviceNameOfGenericDeviceType[service_name];

    var service = Service[service_name];
    if( typeof service === 'function' ) {
      var name = this.siriName;
      if( subtype )
        name = subtype + ' - ' + this.siriName;

      this.log('  ' + service_name + ' service for ' + this.name + (subtype?' (' + subtype + ')':'') );
      var service = new service(name,subtype?subtype:'');
      service.service_name = service_name;
      return service;
    }

    if( service === undefined )
      this.log.error(this.name + ': service name '+ service_name + ' unknown')

    return undefined;
  },

  characteristicOfName: function(name) {
    var parts = name.split('#');
    if( parts[1] ) name = parts[1];

    var characteristic = Characteristic[name];
    if( typeof characteristic === 'function' )
      return characteristic;

    return undefined;
  },

  createDeviceService: function(service_name,subtype) {
    var name = this.siriName;
    if( subtype )
      name = subtype + ' - ' + this.siriName;

    var service = this.serviceOfName(service_name,subtype);
    if( typeof service === 'object' )
      return service;

    this.log('  switch service (default) for ' + this.name + ' (' + subtype + ')' )
    return new Service.Switch(name, subtype);
  },

  identify: function(callback) {
    this.log('['+this.name+'] identify requested!');
    var match;
    if( match = this.PossibleSets.match(/(^| )toggle\b/) ) {
      this.command( 'identify' );
    }
    callback();
  },

  getServices: function() {
    var services = [];

    this.log('creating services for ' + this.name)

    this.log('  information service for ' + this.name)
    var informationService = new Service.AccessoryInformation();
    services.push( informationService );

    this.log('    manufacturer, model and serial number characteristics for ' + this.name)
    informationService
      .setCharacteristic(Characteristic.Manufacturer, this.mappings.Manufacturer
                                                      ?this.mappings.Manufacturer:('FHEM:' + this.type) )
      .setCharacteristic(Characteristic.Model, this.mappings.Model
                                               ?this.mappings.Model:('FHEM:' + (this.model ? this.model : '<unknown>')) )
      .setCharacteristic(Characteristic.SerialNumber, this.mappings.SerialNumber
                                                      ?this.mappings.SerialNumber:(this.serial ? this.serial : '<unknown>') );


    if( this.mappings.FirmwareRevision ) {
      this.log('    firmware revision characteristic for ' + this.name)

      var characteristic = informationService.getCharacteristic(Characteristic.FirmwareRevision)
                           || informationService.addCharacteristic(Characteristic.FirmwareRevision);

      this.subscribe(this.mappings.FirmwareRevision, characteristic);

      characteristic.value = state.cache.values[this.mappings.FirmwareRevision.informId];

      characteristic
        .on('get', function(callback) {
                     if( this.mappings.FirmwareRevision )
                       this.query(this.mappings.FirmwareRevision, callback);
                   }.bind(this) );
    }

    var characteristic = informationService.getCharacteristic(Characteristic.Name);
    if( characteristic ) {
      this.log('    name (siriName) characteristic for ' + this.name)
      characteristic
        .on('set', function(mapping, value, callback, context) {
                     if( context !== 'fromFHEM' ) {
                       //this.log('set name: ' + value);
                       //this.siriName = value;
                       //this.execute( 'attr '+ this.device +' siriName '+ this.siriName );
                       //this.log.info( 'siriName attribute updated.' );
                     }
                     callback();
                   }.bind(this, mapping) )
        .on('get', function(callback) {
                     callback( null, this.siriName );
                   }.bind(this) );
    }

    if( Characteristic.Reachable ) {
      if( this.mappings.Reachable ) {
	this.log.info( '  ' + this.device + ' has reachability ['+ this.mappings.Reachable.reading +']' );
        this.subscribe(this.mappings.Reachable);
      }
    }


    if( this.mappings.colormode
        && (this.mappings.xy || this.mappings.ct) ) {
      this.subscribe(this.mappings.xy);
      this.subscribe(this.mappings.colormode);

      if( this.mappings.xy && state.cache.values[this.mappings.colormode.informId] == 'xy' ) {
        var mapping = this.mappings.xy;
        var value = state.cache.values[mapping.informId];
        var xy = value.split(',');
        var rgb = FHEM_xyY2rgb(xy[0], xy[1] , 1);
        var hsv = FHEM_rgb2hsv(rgb);

        state.cache.values[mapping.device + '-h'] = hsv[0];
        state.cache.values[mapping.device + '-s'] = hsv[1];
        state.cache.values[mapping.device + '-v'] = hsv[2];

      } else if( this.mappings.ct && state.cache.values[this.mappings.colormode.informId] == 'ct' ) {
        var mapping = this.mappings.ct;
        var value = state.cache.values[mapping.informId];
        var rgb = FHEM_ct2rgb(value);
        var hsv = FHEM_rgb2hsv(rgb);

        state.cache.values[mapping.device + '-h'] = hsv[0];
        state.cache.values[mapping.device + '-s'] = hsv[1];
        state.cache.values[mapping.device + '-v'] = hsv[2];
      }

    }


    //this.displayName = this.name;
    this.displayName = this.fuuid;

    var controlService = this.createDeviceService(this.service_name);
    services.push( controlService );

    var service_name = controlService.service_name;
    var service_name_default = controlService.service_name;

    var seen = {};
    var services_hash = {};
    //services_hash[service_name +'#undefined'] = controlService;
    for( var characteristic_type in this.mappings ) {
      var mappings = this.mappings[characteristic_type];
      if( !Array.isArray(mappings) )
         mappings = [mappings];

      if( characteristic_type === 'Reachable' )
        continue;

      if( service_name === 'ContactSensor' && characteristic_type === 'CurrentDoorState'
          && this.mappings.history && this.mappings.ContactSensorState ) {
        this.log.error( this.name + ': skipping CurrentDoorState characteristic as ContactSensor is also given and history is enabled' );
        continue;
      }

      for( var mapping of mappings ) {
        if( mapping._isInformation )
          continue;

        if( Object.keys(services_hash).length == 0 ) {
          controlService.subtype = mapping.subtype;
          services_hash[service_name +'#'+ mapping.subtype] = controlService;
        }

        if( characteristic_type === 'history' ) {
          if( !FakeGatoHistoryService ) {
            this.log.error( this.name + ': fakegato-history not installed' );
            continue;
          }
          if( this.historyService ) {
            this.log.error( this.name + ': FakeGatoHistory already created for'+ service_name );
            continue;
          }

          var type = mapping.type;
          if( !type )
            switch(service_name) {
              case 'AirQualitySensor':
                type = 'room';
                break;
              case 'TemperatureSensor':
                type = 'weather';
                break;
              case 'Thermostat':
                type = 'thermo';
                break;
              case 'ContactSensor':
                type = 'door';
                break;
              case 'MotionSensor':
                type = 'motion';
                break;
              default:
                this.log.error(this.name + ': history: no type known for '+ service_name);
                continue;
            }

          this.log('  ' + 'FakeGatoHistory service with type '+ type +' for ' + service_name);
          this.historyService = new FakeGatoHistoryService( type, this,
                                                            { size: mapping.size?mapping.size: 1024,
                                                              storage:'fs' } );
          services.push( this.historyService );

          if( service_name === 'ContactSensor' ) {
            this.historyService.extra_persist = { TimesOpened: 0, LastActivation: 0, OpenDuration: 0, ClosedDuration: 0, reset: 0 };
            this.historyService.setExtraPersistedData( this.historyService.extra_persist );
          }
          else if( service_name === 'MotionSensor' ) {
            this.historyService.extra_persist = { LastActivation: 0, reset: 0 };
            this.historyService.setExtraPersistedData( this.historyService.extra_persist );
          }

          if( this.historyService.extra_persist ) {
            //this.historyService.on( 'historyLoaded', function() {this.log.error(this.name +': loaded')}.bind(this) );
            this.historyService.checkIfLoaded = function(mapping) {
              if( this.historyService.isHistoryLoaded() ) {
                var extra_persist = this.historyService.getExtraPersistedData();
                if( extra_persist !== undefined ) {
                  this.historyService.extra_persist = extra_persist;
                  this.log(this.name+ ': FakeGatoHistory extra persisted data loaded');
                  if( this.historyService.extra_persist.TimesOpened !== undefined )
                    FHEM_update( mapping.device + '-EVE-TimesOpened', this.historyService.extra_persist.TimesOpened );
                } else
                  this.log(this.name+ ': FakeGatoHistory extra persisted data is empty');
              } else {
                setTimeout(function(mapping) {
                  this.historyService.checkIfLoaded.bind(this)(mapping);
                }.bind(this, mapping), 10);
              }
            }

            this.historyService.checkIfLoaded.bind(this)(mapping);
          }

          if( service_name === 'ContactSensor' ) {
            this.log('    ' + 'FakeGatoHistory reset');
            var characteristic = new Characteristic( 'Reset', 'E863F112-079E-48FF-8F27-9C2605A29F52' );
            this.historyService.addCharacteristic( characteristic );
            characteristic.setProps( { format: Formats['UINT32'] } );
            characteristic.setProps( { perms: [Perms.PAIRED_READ, Perms.PAIRED_WRITE] } );
            //characteristic.setProps( { perms: [Perms.PAIRED_READ, Perms.PAIRED_WRITE, Perms.NOTIFY] } );
            this.log.debug('      props: ' + util.inspect(characteristic.props) );
            characteristic
              .on('set', function(mapping, value, callback, context) {
                           if( context !== 'fromFHEM' ) {
                             this.log('set reset: ' + value);
                             this.historyService.extra_persist.reset = value;
                             FHEM_update( mapping.device + '-EVE-TimesOpened', 0 );
                           }
                           callback();
                         }.bind(this, mapping) )
              .on('get', function(mapping, callback) {
                           var value = this.historyService.extra_persist.reset;
                           if( value === undefined) value = 0;
                           this.log('get reset: ' + value);
                           callback( null, value );
                         }.bind(this, mapping) );
            }

          continue;
        }


        var parts = characteristic_type.split('#');
        if( parts[1] ) {
          service_name = parts[0];
          characteristic_type = parts[1];
          //mapping.characteristic_type = parts[1]

          //handle <service>(<subtype>)#<characteristic>
          var match = service_name.match(/(.+)\((.+)\)$/);
          if( match && match[2] !== undefined ) {
            service_name = match[1];
            mapping.subtype = match[2];
            if( !mapping.name ) mapping.name = service_name +'('+ mapping.subtype +')#'+ characteristic_type;
          }
        } else if( mapping.subtype ) {
          if( !mapping.name ) mapping.name = characteristic_type +'('+ mapping.subtype +')';
        }

        if( seen[service_name +'#'+ characteristic_type] ) {
          if( mapping.subtype === undefined ) {
            this.log.error(this.name + ': '+ characteristic_type + ' characteristic already defined for service ' + this.name + ' and no subtype given');
            continue;
          }
        }

        if( services_hash[service_name +'#'+ mapping.subtype] )
          controlService = services_hash[service_name +'#'+ mapping.subtype];
        else {
          controlService = this.createDeviceService(service_name,mapping.subtype);
          services.push( controlService );
          services_hash[service_name +'#'+ mapping.subtype] = controlService;
        }

        if( mapping.subtype !== undefined ) {
          controlService.subtype = mapping.subtype;
          if( service_name !== 'InputSource' )
            controlService.getCharacteristic(Characteristic.Name).setValue(mapping.subtype);
        }

        if( characteristic_type === 'linkedTo' ) {
          let service = services_hash[mapping.reading +'#undefined'];
          if( !service )
            this.log.error(this.name + ': no '+ mapping.reading +' service to link to' );
          else if( mapping.reading === service_name )
            this.log.error(this.name + ': can\'t link '+ mapping.reading +' service to itself' );
          else {
            service.addLinkedService(controlService);
            this.log('    linked to '+ service.service_name );
          }

          continue;
        }

        if( !mapping.characteristic && mapping.name === undefined ) {
          //this.log.error(this.name + ': '+ ' no such characteristic: ' + characteristic_type );
          continue;
        }


        var characteristic = undefined;
        if( !mapping.characteristic ) {
          if( !mapping.name ) mapping.name = characteristic_type;
          if( CustomUUIDs[characteristic_type] ) characteristic_type = CustomUUIDs[characteristic_type];
          if( !characteristic_type.match( /[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}/i ) ) {
            this.log.error(this.name + ': '+ (mapping.name?mapping.name:mapping.characteristic_type) + ' invalid uuid format: '+ characteristic_type );
            continue;
          }
          if( mapping.name !== undefined ) {
            characteristic = new Characteristic( mapping.name, characteristic_type );
            controlService.addCharacteristic( characteristic );
            mapping.name = 'Custom ' + mapping.name;
          }

        } else
          characteristic = controlService.getCharacteristic(mapping.characteristic)
                           || controlService.addCharacteristic(mapping.characteristic)

        if( characteristic == undefined ) {
          this.log.error(this.name + ': no '+ (mapping.name?mapping.name:mapping.characteristic_type) + ' characteristic available for service ' + service_name);
          continue;
        }
        seen[service_name +'#'+ characteristic_type] = true;

        this.log('    ' + (mapping.name?mapping.name:mapping.characteristic_type)
                        + ' characteristic for ' + mapping.device + ':' + mapping.reading);

        this.subscribe(mapping, characteristic);

        if( mapping.cached !== undefined ) {
          var value = mapping.cached;

          var defined = undefined;
          if( mapping.homekit2name !== undefined ) {
            defined = mapping.homekit2name[value];
            if( defined === undefined )
              defined = '???';
          }

          characteristic.value = value;
          this.log.debug('      initial value is: ' + characteristic.value
                                                    + ' (' + typeof(characteristic.value) + (defined?'; means '+defined:'') + ')' );

        } else if( mapping.default !== undefined ) {
          characteristic.value = mapping.default;
          this.log.debug('      no initial value; default is: ' + characteristic.value + ' (' + typeof(characteristic.value) + ')' );

        } else {
          this.log.debug('      no default' );
        }

        if( mapping.format !== undefined ) characteristic.setProps( { format: Formats[mapping.format] } );
        if( mapping.unit !== undefined ) {
          if( Units[mapping.unit] )
            characteristic.setProps( { unit: Units[mapping.unit] } );
          else
            characteristic.setProps( { unit: mapping.unit } );
        }
        //if( mapping.unit !== undefined ) characteristic.setProps( { unit: Units[mapping.unit] } );
        if( mapping.minValue !== undefined ) characteristic.setProps( { minValue: mapping.minValue } );
        if( mapping.maxValue !== undefined ) characteristic.setProps( { maxValue: mapping.maxValue } );
        if( mapping.minStep !== undefined ) characteristic.setProps( { minStep: mapping.minStep } );
        if( mapping.valid !== undefined ) characteristic.setProps( { validValues: mapping.valid } );

        if( characteristic_type.match( /[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}/i )
            || !characteristic.props || !characteristic.props.perms || !characteristic.props.perms.length ) {
          if( mapping.cmd === undefined )
            characteristic.setProps( { perms: [Perms.PAIRED_READ, Perms.NOTIFY] } );
          else {
            characteristic.setProps( { perms: [Perms.PAIRED_READ, Perms.PAIRED_WRITE, Perms.NOTIFY] } );
          }
        }


        this.log.debug('      props: ' + util.inspect(characteristic.props) );

        characteristic
          .on('set', function(mapping, value, callback, context) {
                       if( context !== 'fromFHEM' ) {
                         if( mapping.delay )
                           this.delayed(mapping, value, mapping.delay);
                         else if( mapping.cmd )
                           this.command(mapping, value);
                         else
                           this.command(mapping, value);

                         if( mapping.timeout && mapping.default !== undefined )
                           setTimeout( function(){mapping.characteristic.setValue(mapping.default, undefined, 'fromFHEM');}, mapping.timeout  );
                       }
                       callback();
                     }.bind(this, mapping) )
          .on('get', function(mapping, callback) {
                       if( this.mappings.Reachable && this.mappings.Reachable.cached === false )
                         callback( 'unreachable' );
                       else
                         this.query(mapping, callback);
                     }.bind(this, mapping) );

      }
    }

    if( this.historyService != undefined ) {
      if( this.mappings.ContactSensorState ) {
        this.log('    ' + 'Custom TimesOpened characteristic '+ mapping.device + ':' + mapping.reading);
        characteristic = new Characteristic( 'TimesOpened', 'E863F129-079E-48FF-8F27-9C2605A29F52' );
        this.mappings['E863F129-079E-48FF-8F27-9C2605A29F52'] = { name: 'Custom TimesOpened', characteristic: characteristic, informId: mapping.device+'-EVE-TimesOpened', log: mapping.log };
        this.subscribe(this.mappings['E863F129-079E-48FF-8F27-9C2605A29F52'], characteristic);
        controlService.addCharacteristic( characteristic );
        characteristic.setProps( { format: Formats['UINT32'] } );
        characteristic.setProps( { perms: [Perms.PAIRED_READ, Perms.NOTIFY] } );
        characteristic
          .on('get', function(mapping, callback) {
                       if( !this.historyService ) {
                         this.log.error(this.name + ': Custom TimesOpened characteristic requires FakeGatoHistory');
                         callback( 'no historyService' );
                         return;
                       }

                       var value = this.historyService.extra_persist.TimesOpened;
                       this.log('query Custom TimesOpened for '+ mapping.device + ':' + mapping.reading +': '+ value);
                       callback( null, value );
                     }.bind(this, mapping) );
      }

      if( (this.mappings.ContactSensorState || this.mappings.MotionDetected)
          && !seen[service_name +'#E863F11A-079E-48FF-8F27-9C2605A29F52']) {
        seen[service_name +'#E863F11A-079E-48FF-8F27-9C2605A29F52'] = true;
        this.log('    ' + 'Custom LastActivation characteristic '+ mapping.device + ':' + mapping.reading);
        characteristic = new Characteristic( 'LastActivation', 'E863F11A-079E-48FF-8F27-9C2605A29F52' );
        this.mappings['E863F11A-079E-48FF-8F27-9C2605A29F52'] = { name: 'Custom LastActivation', characteristic: characteristic, informId: mapping.device+'-EVE-LastActivation', log: mapping.log };
        //this.subscribe(this.mappings['E863F11A-079E-48FF-8F27-9C2605A29F52'], characteristic);
        this.mappings['E863F11A-079E-48FF-8F27-9C2605A29F52'] = { characteristic: characteristic };
        controlService.addCharacteristic( characteristic );
        characteristic.setProps( { format: Formats['UINT32'] } );
        characteristic.setProps( { perms: [Perms.PAIRED_READ] } );
        //characteristic.setProps( { perms: [Perms.PAIRED_READ, Perms.NOTIFY] } );
        this.log.debug('      props: ' + util.inspect(characteristic.props) );
        characteristic
          .on('get', function(mapping, callback) {
                       if( this.historyService === undefined ) {
                         this.log.error(this.name + ': Custom LastActivation characteristic requires FakeGatoHistory');
                         callback( "error" );
                         return;
                       }
                       if( mapping.last_update === undefined ) {
                         this.log.error(this.name + ': Custom LastActivation characteristic: last update unknown ');
                         callback( "error" );
                         return;
                       }

                       var time = this.historyService.getInitialTime();
                       if( time === undefined ) {
                         var entry = { time: mapping.last_update, status: mapping.cached  };
                         mapping.log.info( '      adding history entry '+ util.inspect(entry) );
                         this.historyService.addEntry( entry );
                       }

                       time = mapping.last_update - this.historyService.getInitialTime();

                       this.log('query Custom LastActivation for '+ mapping.device + ':' + mapping.reading +': '+ time);
                       callback( null, time );
                     }.bind(this, mapping) );
        }

      if( this.mappings.ContactSensorState ) {
        this.log('    ' + 'Custom OpenDuration characteristic '+ mapping.device + ':' + mapping.reading);
        characteristic = new Characteristic( 'OpenDuration', 'E863F118-079E-48FF-8F27-9C2605A29F52' );
        controlService.addCharacteristic( characteristic );
        characteristic.setProps( { format: Formats['UINT32'] } );
        characteristic.setProps( { perms: [Perms.PAIRED_READ, Perms.PAIRED_WRITE, Perms.NOTIFY] } );
        characteristic
          .on('get', function(mapping, callback) {
                       var value = 0;
                       this.log('query Custom OpenDuration for '+ mapping.device + ':' + mapping.reading +': '+ value);
                       callback( null, value );
                     }.bind(this, mapping) );

        this.log('    ' + 'Custom ClosedDuration characteristic '+ mapping.device + ':' + mapping.reading);
        characteristic = new Characteristic( 'ClosedDuration', 'E863F119-079E-48FF-8F27-9C2605A29F52' );
        controlService.addCharacteristic( characteristic );
        characteristic.setProps( { format: Formats['UINT32'] } );
        characteristic.setProps( { perms: [Perms.PAIRED_READ, Perms.PAIRED_WRITE, Perms.NOTIFY] } );
        characteristic
          .on('get', function(mapping, callback) {
                       var value = 0;
                       this.log('query Custom ClosedDuration for '+ mapping.device + ':' + mapping.reading +': '+ value);
                       callback( null, value );
                     }.bind(this, mapping) );

      }
    }

    return services;
  }

};


//http server for debugging

var FHEMdebug_PORT=8282;

function FHEMdebug_handleRequest(request, response){
  //console.log( request );

  if( request.url == '/cached' ) {
    response.write( '<a href="/">home</a><br><br>' );
    for( var key in FHEM_longpoll ) {
      response.write( key + '<br>' );
      response.write( '&nbsp;&nbsp;connected: ' + FHEM_longpoll[key].connected );
      response.write( '; connects: ' + FHEM_longpoll[key].connects +'<br>' );
      response.write( '&nbsp;&nbsp;received: '+ FHEM_longpoll[key].received );
      response.write( '; received total: ' + FHEM_longpoll[key].received_total +'<br>' );
      if( FHEM_longpoll[key].last_event_time )
        response.write( '&nbsp;&nbsp;last event: ' + new Date(FHEM_longpoll[key].last_event_time) +'<br>' );
     }
    response.write( '<br>' );

    for( var informId in state.subscriptions.byInformId ) {
      response.write( informId + ': '+ state.cache.values[informId] +'<br>' );

      var derived = false;
      for( var subscription of state.subscriptions.byInformId[informId] ) {
        var characteristic = subscription.characteristic;
        if( !characteristic ) continue;

        var mapping = characteristic.FHEM_mapping;
        if( !mapping || mapping.cached === undefined ) continue;

        derived = true;

        var value = mapping.cached;

        var defined = undefined;
        if( mapping.homekit2name !== undefined ) {
          defined = mapping.homekit2name[value];
          if( defined === undefined )
            defined = '???';
        }
        response.write( '&nbsp;&nbsp;' + mapping.characteristic_type + ': '+ value + ' (' + typeof(value)+ (defined?'; means '+defined:'') +')<br>' );
      }
      //if( derived )
        response.write( '<br>' );
    }
    //response.write( '<br>cached: ' + util.inspect(state.cache.values).replace(/\n/g, '<br>') );
    response.end( '' );

  } else if( request.url == '/subscriptions' ) {
    response.write( '<a href="/">home</a><br><br>' );
    response.end( '<pre>subscriptions: ' + util.inspect(state.subscriptions.byInformId, {depth: 5}) + '</pre>');

  } else
    response.end( '<a href="/cached">cached</a><br><a href="/subscriptions">subscriptions</a>' );
}

var FHEMdebug_server = http.createServer( FHEMdebug_handleRequest );

FHEMdebug_server.on('error', function (e) {
  console.log('Server error: ' + e);

  if( FHEMdebug_PORT == 8282 ) {
    FHEMdebug_PORT = 8283;
    FHEMdebug_server.close();
    FHEMdebug_server.listen(FHEMdebug_PORT);
  }
});

//Lets start our server
// the tests load this file many times in parallel and switch the server off
if( process.env.FHEM2HB_DEBUG_SERVER !== 'off' )
FHEMdebug_server.listen(FHEMdebug_PORT, function(){
    console.log('Server listening on: http://<ip>:%s', FHEMdebug_PORT);
});

// the plugin does not export its internals. the tests reach them through this.
export const __internals = {
  useHap: function(hap) {
    Accessory = hap.Accessory; Service = hap.Service; Characteristic = hap.Characteristic; UUIDGen = hap.uuid;
    Units = hap.Units; Formats = hap.Formats; Perms = hap.Perms;
    state = new PluginState(hap);
    return state;
  },
  useUser: function(user) { User = user },
  useFakeGato: function(service) { FakeGatoHistoryService = service },

  FHEMPlatform: FHEMPlatform,
  FHEMAccessory: FHEMAccessory,

  FHEM_longpoll: FHEM_longpoll,
  FHEM_csrfToken: FHEM_csrfToken,
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
