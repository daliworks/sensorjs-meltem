'use strict';

var util = require('util');
var _ = require('lodash');
var EventEmitter = require('events').EventEmitter;
var logger = require('./index').Sensor.getLogger('Sensor');
var STATUS_FIELDS = ['mode', 'speed', 'current', 'pressure', 'power', 'temperature'];

function MeltemCVSDevice(master, id) {
  var self = this;

  self.id = id;
  self.master = master;
  self.settings['s01'] = { value: 0, new: false, setCommand: 'S01'};
  self.settings['s02'] = { value: 3, new: false, setCommand: 'S02'};
  self.settings['s03'] = { value: 0, new: false, setCommand: 'S03'};
  self.settings['s04'] = { value: 3, new: false, setCommand: 'S04'};
  self.settings['s05'] = { value: 270, new: false, setCommand: 'S05'};
  self.settings['s06'] = { value: 100, new: false, setCommand: 'S06'};
  self.settings['s07'] = { value: 80, new: false, setCommand: 'S07'};
  self.settings['s08'] = { value: 60, new: false, setCommand: 'S08'};
  self.settings['s09'] = { value: 40, new: false, setCommand: 'S09'};
  self.settings['s10'] = { value: 5, new: false, setCommand: 'S10'};
  self.settings['s11'] = { value: 1, new: false, setCommand: 'S11'};
  self.settings['s12'] = { value: 1440, new: false, setCommand: 'S12'};
  self.settings['s13'] = { value: -50, new: false, setCommand: 'S13'};
  self.settings['s14'] = { value: 2, new: false, setCommand: 'S14'};
  self.settings['s15'] = { value: 10, new: false, setCommand: 'S15'};
  self.settings['s16'] = { value: 5, new: false, setCommand: 'S16'};
  self.settings['s17'] = { value: -210, new: false, setCommand: 'S17'};
  self.settings['s18'] = { value: 3, new: false, setCommand: 'S18'};
  self.settings['s19'] = { value: 50, new: false, setCommand: 'S19'};
  self.settings['s20'] = { value: 20, new: false, setCommand: 'S20'};
  self.settings['s21'] = { value: 50, new: false, setCommand: 'S21'};
  self.settings['s22'] = { value: -380, new: false, setCommand: 'S22'};
  self.settings['s23'] = { value: 10, new: false, setCommand: 'S23'};
  self.settings['s24'] = { value: 30, new: false, setCommand: 'S24'};
  self.settings['set1_rpm'] = { value: 580, new: false, setCommand: 'T01'};
  self.settings['set1_current'] = { value: 74, new: false, setCommand: 'T02'};
  self.settings['set2_rpm'] = { value: 760, new: false, setCommand: 'T03'};
  self.settings['set2_current'] = { value: 431, new: false, setCommand: 'T04'};
  self.settings['set3_rpm'] = { value: 760, new: false, setCommand: 'T05'};
  self.settings['set3_current'] = { value: 431, new: false, setCommand: 'T06'};
  self.settings['fixed_rpm'] = { value: 850, new: false, setCommand: 'R00'};

  self.seriesCommandSets = [ 
    { 
      command : 'D00', 
      timeout : self.master.responseWaitingTime
    }, 
    { 
      command : 'D80', 
      timeout : self.master.responseWaitingTime
    }, 
    {
      command : 'F01',
      timeout : self.master.responseWaitingTime
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

      clearTimeout(self.timeoutID);
      self.timeoutID = undefined;

      self.onData(self.commandSet.command, data);
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

    //if ( settings.s01 != undefined ) self.setValue('s01', settings.s01);
    if ( settings.s02 != undefined ) self.setValue('s02', settings.s02);
    if ( settings.s03 != undefined ) self.setValue('s03', settings.s03);
    if ( settings.s04 != undefined ) self.setValue('s04', settings.s04);
    if ( settings.s05 != undefined ) self.setValue('s05', settings.s05);
    if ( settings.s06 != undefined ) self.setValue('s06', settings.s06);
    if ( settings.s07 != undefined ) self.setValue('s07', settings.s07);
    if ( settings.s08 != undefined ) self.setValue('s08', settings.s08);
    if ( settings.s09 != undefined ) self.setValue('s09', settings.s09);
    if ( settings.s10 != undefined ) self.setValue('s10', settings.s10);
    if ( settings.s11 != undefined ) self.setValue('s11', settings.s11);
    if ( settings.s12 != undefined ) self.setValue('s12', settings.s12);
    if ( settings.s13 != undefined ) self.setValue('s13', settings.s13);
    if ( settings.s14 != undefined ) self.setValue('s14', settings.s14);
    if ( settings.s15 != undefined ) self.setValue('s15', settings.s15);
    if ( settings.s16 != undefined ) self.setValue('s16', settings.s16);
    if ( settings.s17 != undefined ) self.setValue('s17', settings.s17);
    if ( settings.s18 != undefined ) self.setValue('s18', settings.s18);
    if ( settings.s19 != undefined ) self.setValue('s19', settings.s19);
    if ( settings.s20 != undefined ) self.setValue('s20', settings.s20);
    if ( settings.s21 != undefined ) self.setValue('s21', settings.s21);
    if ( settings.s22 != undefined ) self.setValue('s22', settings.s22);
    if ( settings.s23 != undefined ) self.setValue('s23', settings.s23);
    if ( settings.s24 != undefined ) self.setValue('s24', settings.s24);
    if ( settings.set1 != undefined ) {
      if (settings.set1.rpm != undefined) self.setValue('set1_rpm', settings.set1.rpm);
      if (settings.set1.current != undefined) self.setValue('set1_current', settings.set1.current);
    }
    if ( settings.set2 != undefined ) {
      if (settings.set2.rpm != undefined) self.setValue('set2_rpm', settings.set2.rpm);
      if (settings.set2.current != undefined) self.setValue('set2_current', settings.set2.current);
    }
    if ( settings.set3 != undefined ) {
      if (settings.set3.rpm != undefined) self.setValue('set3_rpm', settings.set3.rpm);
      if (settings.set3.current != undefined) self.setValue('set3_current', settings.set3.current);
    }
    if ( settings.rpm != undefined ) self.setValue('fixed_rpm', settings.rpm);

    logger.trace('Settings : ', self.settings);
  });
}

util.inherits(MeltemCVSDevice, EventEmitter);

MeltemCVSDevice.prototype.setValue = function(field, setting) {
  var self = this;
  var i;

  if ((self.settings[field] != undefined) || ((setting != undefined) && (setting.value != undefined))) {
    self.settings[field].value = setting.value;
    self.settings[field].new = true;

    for (i = 0; i < self.setCommandSets.length; i++) {
      if (self.setCommandSets[i].command == self.settings[field].setCommand) {
        self.setCommandSets[i].value = value;
        return;
      }
    }

    self.setCommandSets.push({ command: self.settings[field].setCommand, timeout: self.master.responseWaitingTime });
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
  var self = this;
  var i;


  for(i = 0 ; i < self.settings.length ; i++) {
    if (self.settings[i].new) {
    }
  }
}

MeltemCVSDevice.prototype.onData  = function(cmd, payload) {
  var self = this;
  var item = {};
  var dataArray = payload.split(' ');

  try {
    switch (cmd) {
      case 'D00':
        {
          var mode;
          var pressure;
          var current;
          if ((payload.length != 28) || (dataArray.length != 6) || (self.id != dataArray[1])) {
            throw 'Invalid payload : ' + payload;
          }

          mode = dataArray[2];
          pressure = parseInt(dataArray[3].substr(0, 4));
          if (pressure == NaN) {
            throw 'Invalid field[3] : ' + dataArray[3];
          }

          current = parseInt(dataArray[5].substr(0, 4));
          if (current == NaN) {
            throw 'Invalid field[4] : ' + dataArray[5];
          }

          self.master.emit(self.id + '-mode', { sequence: 'mode', value: mode });
          self.master.emit(self.id + '-pressure', { sequence: 'pressure', value: pressure });
          self.master.emit(self.id + '-current', { sequence: 'current', value: current });
          self.master.emit(self.id + '-power', { sequence: 'power', value: (current * 2 * 200 / 1000) });
        }
        break;

      case 'D80':
        {
          if ((payload.length != 13) || (dataArray.length != 3) || (self.id != dataArray[1])) {
            throw 'Invalid payload : ' + payload;
          }

          var speed = parseInt(dataArray[2].substr(0, 4));
          if (speed == NaN) {
            throw 'Invalid field[2] : ' + dataArray[2];
          }

          self.master.emit(self.id + '-speed', { sequence: 'speed', value: speed });
        }
        break;

      case 'F01':
        {
          if ((payload.length != 13) || (dataArray.length != 3) || (self.id != dataArray[1])) {
            throw 'Invalid payload : ' + payload;
          }

          var temperature = parseInt(dataArray[2].substr(0, 5));
          if (temperature == NaN) {
            throw 'Invalid field[2] : ' + dataArray[2];
          }

          self.master.emit(self.id + '-temperature', { sequence: 'temperature', value: temperature });
        }
        break;

      default:
        return;
    }
  }
  catch (err) {
    logger.error(err);
  }
}

function CreateInstance(master, id) {
   var  instance;

   instance = new MeltemCVSDevice(master, id);

   return instance;
 }

module.exports = {
   create: CreateInstance
 }; 