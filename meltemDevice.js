'use strict';

var util = require('util');
var _ = require('lodash');
var EventEmitter = require('events').EventEmitter;
var logger = require('./index').Sensor.getLogger('Sensor');
var STATUS_FIELDS = ['mode', 'speed', 'current', 'pressure', 'temperature'];
var SETTINGS_COMMON_S01_INDEX = 0;
var SETTINGS_COMMON_S02_INDEX = 1;
var SETTINGS_COMMON_S03_INDEX = 2;
var SETTINGS_COMMON_S04_INDEX = 3;
var SETTINGS_COMMON_S05_INDEX = 4;
var SETTINGS_COMMON_S06_INDEX = 5;
var SETTINGS_COMMON_S07_INDEX = 6;
var SETTINGS_COMMON_S08_INDEX = 7;
var SETTINGS_COMMON_S09_INDEX = 8;
var SETTINGS_COMMON_S10_INDEX = 9;
var SETTINGS_COMMON_S11_INDEX = 10;
var SETTINGS_COMMON_S12_INDEX = 11;
var SETTINGS_SET1_S13_INDEX = 12;
var SETTINGS_SET1_S14_INDEX = 13;
var SETTINGS_SET1_S15_INDEX = 14;
var SETTINGS_SET1_S16_INDEX = 15;
var SETTINGS_SET2_S17_INDEX = 16;
var SETTINGS_SET2_S18_INDEX = 17;
var SETTINGS_SET2_S19_INDEX = 18;
var SETTINGS_SET2_S20_INDEX = 19;
var SETTINGS_SET2_S21_INDEX = 20;
var SETTINGS_SET3_S22_INDEX = 21;
var SETTINGS_SET3_S23_INDEX = 22;
var SETTINGS_SET3_S24_INDEX = 23;
var SETTINGS_SET1_RPM_INDEX = 24;
var SETTINGS_SET1_CURRENT_INDEX = 25;
var SETTINGS_SET2_RPM_INDEX = 26;
var SETTINGS_SET2_CURRENT_INDEX = 27;
var SETTINGS_FIXED_RPM_INDEX = 28;

var DEFAULT_SETTINGS= [
  { value: 0, new: false, setCommand: 'S01' }, // common.s01
  { value: 3, new: false, setCommand: 'S02' }, // common.s02
  { value: 0, new: false, setCommand: 'S03' }, // common.s03
  { value: 3, new: false, setCommand: 'S04' }, // common.s04
  { value: 270, new: false, setCommand: 'S05' }, // common.s05
  { value: 100, new: false, setCommand: 'S06' }, // common.s06
  { value: 80, new: false, setCommand: 'S07' }, // common.s07
  { value: 60, new: false, setCommand: 'S08' }, // common.s08
  { value: 40, new: false, setCommand: 'S09' }, // common.s09
  { value: 5, new: false, setCommand: 'S10' }, // common.s10
  { value: 1, new: false, setCommand: 'S11' }, // common.s11
  { value: 1440, new: false, setCommand: 'S12' }, // common.s12
  { value: -50, new: false, setCommand: 'S13' }, // set1.s13
  { value: 2, new: false, setCommand: 'S14' }, // set1.s14
  { value: 10, new: false, setCommand: 'S15' },  // set1.s15
  { value: 5, new: false, setCommand: 'S16' }, // set1.s16
  { value: -210, new: false, setCommand: 'S17' }, // set2.s17
  { value: 3, new: false, setCommand: 'S18' }, // set2.s18
  { value: 50, new: false, setCommand: 'S19' }, // set2.s19
  { value: 20, new: false, setCommand: 'S20' }, // set2.s20
  { value: 50, new: false, setCommand: 'S21' }, // set2.s21
  { value: -380, new: false, setCommand: 'S22' }, // set3.s22
  { value: 10, new: false, setCommand: 'S23' }, // set3.s23
  { value: 30, new: false, setCommand: 'S24' },// set3.s24
  { value: 580, new: false, setCommand: 'T01' },  // set1_rpm
  { value: 74, new: false, setCommand: 'T02' }, // set1_current
  { value: 760, new: false, setCommand: 'T03' },  // set2_rpm
  { value: 431, new: false, setCommand: 'T04'}, // set2_current
  { value: 850, new: false, command: 'T05'} // fixed_rpm
];

function MeltemCVSDeviceOnData(self, parsedPayload) {
  STATUS_FIELDS.map(function (field) {
    var item = {};

    item.sequence = field;
    switch (field) {
      case 'mode': item.value = parsedPayload.mode; break;
      case 'pressure': item.value = parsedPayload.pressure; break;
      case 'speed': item.value = parsedPayload.speed; break;
      case 'current': item.value = parsedPayload.current; break;
      case 'power': item.value = parsedPayload.power; break;
      case 'temperature': item.value = parsedPayload.temperature; break;
      default: return;
    }

    self.master.emit(parsedPayload.id + '-' + field, item);
  });
}

function MeltemCVSDevice(master, id) {
  var self = this;

  self.id = id;
  self.master = master;
  self.settings = DEFAULT_SETTINGS;
  self.seriesCommandSets = [ 
    { 
      command : 'D00', 
      timeout : self.master.responseWaitingTime,
      onData : function(parsedPayload) {
        if (parsedPayload.items.length == 6) {
          MeltemCVSDeviceOnData(self, parsedPayload);
        }
      }
    }, 
    { 
      command : 'D01', 
      timeout : self.master.responseWaitingTime,
      onData : function(parsedPayload) {
      }
    }, 
    {
      command : 'F01',
      timeout : self.master.responseWaitingTime,
      onData : function(parsedPayload) {
        if (parsedPayload.items.length == 3) {
          MeltemCVSDeviceOnData(self, parsedPayload);
        }
      }
    }
  ];
  self.setCommandSets = [];
  self.commandSet = 0;
  self.commandSets = [];

  self.responseCB = undefined;
  self.timeoutID = undefined;
  
  EventEmitter.call(self);

  logger.trace('Device : ', self);
  
  self.on('data', function(payload) {
    if (self.commandSet != undefined) {
      var data = new Buffer(payload).toString().replace(/[\n\r]+/g, '');
      logger.trace('[Meltem CVS Device] onData():', data);

      var parsedPayload = ParsePayload(data);
      if ((parsedPayload instanceof Error) || (parsedPayload.id != self.id)) {
        logger.error(parsedPayload);
        return;
      }

      clearTimeout(self.timeoutID);
      self.timeoutID = undefined;

      if (self.commandSet.onData != undefined) {
        self.commandSet.onData(parsedPayload);
      }

      self.commandSet = undefined;

      if (self.commandSets.length != 0) {
        self.onRequest(self.commandSets.shift());
      }
      else if (self.setCommandSets.length != 0) {
        self.onRequest(self.setCommandSets.shift());
      }
    }
  });

  self.on('update', function (startDelay, occupationTime) {
    setTimeout(function () {
      var date = new Date;

      self.commandSets = self.seriesCommandSets.slice();

      self.onRequest(self.commandSets.shift());
      self.timeout = date.getTime() + occupationTime;
    }, startDelay);
  });

  self.on('settings', function(settings){

    self.setValue(SETTINGS_COMMON_S01_INDEX, settings.s01);
    self.setValue(SETTINGS_COMMON_S02_INDEX, settings.s02);
    self.setValue(SETTINGS_COMMON_S03_INDEX, settings.s03);
    self.setValue(SETTINGS_COMMON_S04_INDEX, settings.s04);
    self.setValue(SETTINGS_COMMON_S05_INDEX, settings.s05);
    self.setValue(SETTINGS_COMMON_S06_INDEX, settings.s06);
    self.setValue(SETTINGS_COMMON_S07_INDEX, settings.s07);
    self.setValue(SETTINGS_COMMON_S08_INDEX, settings.s08);
    self.setValue(SETTINGS_COMMON_S09_INDEX, settings.s09);
    self.setValue(SETTINGS_COMMON_S10_INDEX, settings.s10);
    self.setValue(SETTINGS_COMMON_S11_INDEX, settings.s11);
    self.setValue(SETTINGS_COMMON_S12_INDEX, settings.s12);
    self.setValue(SETTINGS_SET1_S13_INDEX, settings.s13);
    self.setValue(SETTINGS_SET1_S14_INDEX, settings.s14);
    self.setValue(SETTINGS_SET1_S15_INDEX, settings.s15);
    self.setValue(SETTINGS_SET1_S16_INDEX, settings.s16);
    self.setValue(SETTINGS_SET2_S17_INDEX, settings.s17);
    self.setValue(SETTINGS_SET2_S18_INDEX, settings.s18);
    self.setValue(SETTINGS_SET2_S19_INDEX, settings.s19);
    self.setValue(SETTINGS_SET2_S20_INDEX, settings.s20);
    self.setValue(SETTINGS_SET2_S21_INDEX, settings.s21);
    self.setValue(SETTINGS_SET3_S22_INDEX, settings.s22);
    self.setValue(SETTINGS_SET3_S23_INDEX, settings.s23);
    self.setValue(SETTINGS_SET3_S24_INDEX, settings.s24);
    self.setValue(SETTINGS_SET1_RPM, settings.set1_rpm);
    self.setValue(SETTINGS_SET1_CURRENT, settings.set1_current);
    self.setValue(SETTINGS_SET2_RPM, settings.set2_rpm);
    self.setValue(SETTINGS_SET2_CURRENT, settings.set2_current);
    self.setValue(SETTINGS_FIXED_RPM.fixed_rpm);

    logger.trace('New Settings : ', self.newSettings);
    logger.trace('Settings : ', self.settings);
  });
}

util.inherits(MeltemCVSDevice, EventEmitter);

MeltemCVSDevice.prototype.setValue = function(field, value) {
  var self = this;
  var i;

  if (value != undefined) {
    self.settings[field].value = value;
    self.settings[field].new = true;

    for (i = 0; i < self.setCommandSets.length; i++) {
      if (self.setCommandSets[i].command == DEFAULT_SETTINGS[field].command) {
        self.setCommandSets[i].value = value;
        return;
      }
    }

    self.setCommandSets.push({ command: DEFAULT_SETTINGS[field].setCommand, timeout: self.master.responseWaitingTime });
  }
}

MeltemCVSDevice.prototype.getOccupationTime = function (responseTime) {
  var self = this;

  return  self.seriesCommandSets.length * responseTime;
}

MeltemCVSDevice.prototype.onRequest = function(commandSet) {
  var self = this;

  try{
    self.commandSet = commandSet;
    self.master.sendMessage(self.id, commandSet.command);
    self.timeoutID = setTimeout(function () {
      logger.trace('On Request Timeout : ', self.id, self.commandSet.command);
      self.commandSet = undefined;
    }, commandSet.timeout);
  }
  catch(err) {
    logger.error('Exception occurred : ', err, commandSet);
  }
}

MeltemCVSDevice.prototype.onUpdateSettings = function(timeout) {
  var i;

  if (self.newSettings == 0) {
    return;
  }

  for(i = 0 ; i < self.settings.length ; i++) {
    if (self.settings[i].new) {
    }
  }
}

function CreateInstance(master, id) {
   var  instance;

   instance = new MeltemCVSDevice(master, id);

   return instance;
 }

function ParsePayload(payload) {
  var result = {};
  var dataArray = payload.split(' ');
  var error;

  try {
    if (payload.length == 28) {
      if (dataArray.length != 6) {
        throw 'Invalid payload : ' + payload;
      }

      result.id = dataArray[1];
      result.mode = dataArray[2];
      result.pressure = parseInt(dataArray[3].substr(0, 4));
      if (result.pressure == NaN) {
        throw 'Invalid field[3] : ' + dataArray[3];
      }

      result.speed = parseInt(dataArray[4].substr(0, 4));
      if (result.speed == NaN) {
        throw 'Invalid field[4] : ' + dataArray[4];
      }

      result.current = parseInt(dataArray[5].substr(0, 4));
      if (result.current == NaN) {
        result.power = NaN;
        throw 'Invalid field[4] : ' + dataArray[5];
      }
      else {
        result.power = result.current * 2 * 220 / 1000;
      }
    }
    else if (payload.length == 13) {
      if (dataArray.length != 3) {
        throw 'Invalid payload : ' + payload;
      }

      result.id = dataArray[1];
      result.temperature = parseInt(dataArray[2].substr(0, 5));
      if (result.pressure == NaN) {
        throw 'Invalid field[3] : ' + dataArray[2];
      }
    }
    else {
        throw 'Invalid payload : ' + payload;
    }

    result.items = dataArray;
    logger.trace('Parsed:', result);
  }
  catch (err) {
    error = new Error(err);
  }

  return error || result;
}

module.exports = {
   create: CreateInstance
 }; 