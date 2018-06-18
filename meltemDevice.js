'use strict';

var util = require('util');
var EventEmitter = require('events').EventEmitter;
var logger = require('./index').Sensor.getLogger('Sensor');
var stepTable = [
  { 'name' : 'S1', 'step' : 0},
  { 'name' : 'T1', 'step' : 1},
  { 'name' : 'T2', 'step' : 2},
  { 'name' : 'T3', 'step' : 3},
  { 'name' : 'R1', 'step' : 4},
  { 'name' : 'R2', 'step' : 5},
  { 'name' : 'R3', 'step' : 6},
  { 'name' : 'F1', 'step' : 7}
];

function MeltemCVSDevice(master, id) {
  var self = this;

  self.id = id;
  self.master = master;
  self.settings={
    s01: { value: 1, new: false, setCommand: 'S01' },
    s02: { value: 2, new: false, setCommand: 'S02' },
    s03: { value: 0, new: false, setCommand: 'S03' },
    s04: { value: 3, new: false, setCommand: 'S04' },
    s05: { value: 270, new: false, setCommand: 'S05' },
    s06: { value: 100, new: false, setCommand: 'S06' },
    s07: { value: 80, new: false, setCommand: 'S07' },
    s08: { value: 60, new: false, setCommand: 'S08' },
    s09: { value: 40, new: false, setCommand: 'S09' },
    s10: { value: 5, new: false, setCommand: 'S10' },
    s11: { value: 1, new: false, setCommand: 'S11' },
    s12: { value: 1750, new: false, setCommand: 'S12' },
    s13: { value: -100, new: false, setCommand: 'S13' },
    s14: { value: 2, new: false, setCommand: 'S14' },
    s15: { value: 10, new: false, setCommand: 'S15' },
    s16: { value: 20, new: false, setCommand: 'S16' },
    s17: { value: -180, new: false, setCommand: 'S17' },
    s18: { value: 3, new: false, setCommand: 'S18' },
    s19: { value: 120, new: false, setCommand: 'S19' },
    s20: { value: 150, new: false, setCommand: 'S20' },
    s21: { value: 30, new: false, setCommand: 'S21' },
    s22: { value: -250, new: false, setCommand: 'S22' },
    s23: { value: 10, new: false, setCommand: 'S23' },
    s24: { value: 30, new: false, setCommand: 'S24' },
    set1Rpm: { value: 0, new: false, setCommand: 'T01' },
    set1Current: { value: 0, new: false, setCommand: 'T02' },
    set2Rpm: { value: 0, new: false, setCommand: 'T03' },
    set2Current: { value: 0, new: false, setCommand: 'T04' },
    set3Rpm: { value: 0, new: false, setCommand: 'T05' },
    set3Current: { value: 0, new: false, setCommand: 'T06' },
    set3OpenRpm: { value: 0, new: false, setCommand: 'T07' },
    set3OpenCurrent: { value: 0, new: false, setCommand: 'T08' }
};

  self.seriesCommandSets = [ 
    { 
      command : 'D00', 
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

  self.on('D00', function(data) {
    self.onD00(data);
  });

  self.on('D60', function(data) {
    self.onD60(data);
  });

  self.on('D61', function(data) {
    self.onD61(data);
  });

  self.on('data', function(data) {
    if (data.length < 11) {
      logger.error('Invalid Data : ', data);
      return;
    }

    logger.trace('[Meltem CVS Device] onData():', data);

    switch(data.substr(7, 3)) {
      case 'D00': { self.onD00(data); } break;
      case 'D60': { self.onD60(data); } break;
      case 'D61': { self.onD61(data); } break;
      default: {
        logger.info('[Device] Command set undefined : ', data);
        return;
      }
    }

    if (self.timeoutID) {
      clearTimeout(self.timeoutID);
      self.timeoutID = undefined;
    }

    self.commandSet = undefined;

    if (self.commandSets.length) {
      self.onRequest(self.commandSets.shift());
    }
    else if (self.setCommandSets.length) {
      self.onRequest(self.setCommandSets.shift());
    }
  });

  self.on('update', function (startDelay, occupationTime) {
    setTimeout(function () {
      var date = new Date();

      self.commandSets = self.seriesCommandSets.slice();

      self.onRequest(self.commandSets.shift());
      self.timeout = date.getTime() + occupationTime;
    }, startDelay);
  });

  self.on('settings', function(settings){

    //if ( settings.s01 ) { self.setValue('s01', settings.s01); }
    if ( settings.s02 ) { self.setValue('s02', settings.s02); }
    if ( settings.s03 ) { self.setValue('s03', settings.s03); }
    if ( settings.s04 ) { self.setValue('s04', settings.s04); } 
    if ( settings.s05 ) { self.setValue('s05', settings.s05); }
    if ( settings.s06 ) { self.setValue('s06', settings.s06); }
    if ( settings.s07 ) { self.setValue('s07', settings.s07); }
    if ( settings.s08 ) { self.setValue('s08', settings.s08); }
    if ( settings.s09 ) { self.setValue('s09', settings.s09); }
    if ( settings.s10 ) { self.setValue('s10', settings.s10); }
    if ( settings.s11 ) { self.setValue('s11', settings.s11); }
    if ( settings.s12 ) { self.setValue('s12', settings.s12); }
    if ( settings.s13 ) { self.setValue('s13', settings.s13); }
    if ( settings.s14 ) { self.setValue('s14', settings.s14); }
    if ( settings.s15 ) { self.setValue('s15', settings.s15); }
    if ( settings.s16 ) { self.setValue('s16', settings.s16); }
    if ( settings.s17 ) { self.setValue('s17', settings.s17); }
    if ( settings.s18 ) { self.setValue('s18', settings.s18); }
    if ( settings.s19 ) { self.setValue('s19', settings.s19); }
    if ( settings.s20 ) { self.setValue('s20', settings.s20); }
    if ( settings.s21 ) { self.setValue('s21', settings.s21); }
    if ( settings.s22 ) { self.setValue('s22', settings.s22); }
    if ( settings.s23 ) { self.setValue('s23', settings.s23); }
    if ( settings.s24 ) { self.setValue('s24', settings.s24); }
    if ( settings.set1 ) {
      if (settings.set1.rpm ) { self.setValue('set1Rpm', settings.set1.rpm); }
      if (settings.set1.current ) { self.setValue('set1Current', settings.set1.current); }
    }
    if ( settings.set2 ) {
      if (settings.set2.rpm ) { self.setValue('set2Rpm', settings.set2.rpm); }
      if (settings.set2.current ) { self.setValue('set2Current', settings.set2.current); }
    }
    if ( settings.set3 ) {
      if (settings.set3.rpm ) { self.setValue('set3Rpm', settings.set3.rpm); }
      if (settings.set3.current ) { self.setValue('set3Current', settings.set3.current); }
    }
    if ( settings.set3Open ) {
      if (settings.set3Open.rpm ) { self.setValue('set3OpenRpm', settings.set3Open.rpm); }
      if (settings.set3Open.current ) { self.setValue('set3OpenCurrent', settings.set3Open.current); }
    }

    logger.trace('Settings : ', self.settings);
  });
}

util.inherits(MeltemCVSDevice, EventEmitter);

MeltemCVSDevice.prototype.setValue = function(field, value) {
  var self = this;
  var j;

  if (!value) {
    return;
  }

  if (self.settings[field]) {
    self.settings[field].value = value;
    self.settings[field].new = true;

    for (j = 0; j < self.setCommandSets.length; j++) {
      if (self.setCommandSets[j].command === self.settings[field].setCommand) {
        self.setCommandSets[j].value = value;
        return;
      }
    }

    self.setCommandSets.push({ command: self.settings[field].setCommand, timeout: self.master.responseWaitingTime });
    return;
  }
};

MeltemCVSDevice.prototype.getOccupationTime = function (responseTime) {
  var self = this;

  return self.seriesCommandSets.length * responseTime;
};

MeltemCVSDevice.prototype.onRequest = function(commandSet) {
  var self = this;

  try{
    self.commandSet = commandSet;
    self.master.emit('message', self.id, commandSet.command);
    self.timeoutID = setTimeout(function () {
      logger.error('Request Timeout : ', self.id, self.commandSet.command);
      self.commandSet = undefined;
    }, commandSet.timeout);
  }
  catch(err) {
    logger.error('Exception occurred : ', err, commandSet);
  }
};

MeltemCVSDevice.prototype.onD00 = function(data) {
  var self = this;

  if (!_.isString(data) || data.length !== 34) {
    logger.error('Invalid Data : ', data);
    return;
  }

  try {
    var stepObject = _.find(stepTable, { 'name' : data.substr(22, 2)});
    if (stepObject) {
     logger.error('Invalid Step: ', data.substr(22, 2));
     return;
    }

    var pressure = parseInt(data.substr(10, 4));
    var rpm = parseInt(data.substr(14, 4));
    var current = parseInt(data.substr(18, 4));
    var temperature = parseInt(data.substr(24, 4));
    var operatingTime = parseInt(data.substr(28, 5));

    self.master.emit(self.id + '-mode', { sequence: 'mode', value: stepObject.step });
    self.master.emit(self.id + '-pressure', { sequence: 'pressure', value: pressure });
    self.master.emit(self.id + '-rpm', { sequence: 'rpm', value: rpm });
    self.master.emit(self.id + '-current', { sequence: 'current', value: current });
    self.master.emit(self.id + '-temperature', { sequence: 'temperature', value: temperature });
    self.master.emit(self.id + '-operating_time', { sequence: 'operating_time', value: operatingTime});
  }
  catch(err) {
    logger.error(err);
  }
};

MeltemCVSDevice.prototype.onD60 = function(data) {
  var self = this;

  if (!_.isString(data) || data.length !== 59) {
    logger.error('Invalid Data : ', data);
    return;
  }

  try {
    var i;
    var settings = [];

    for(i = 0; i < 12 ; i++ ) {
      settings[i]  = parseInt(data.substr(10 + i * 4, 4));
    }

    self.settings.s01 = settings[0];
    self.settings.s02 = settings[1];
    self.settings.s03 = settings[2];
    self.settings.s04 = settings[3];
    self.settings.s05 = settings[4];
    self.settings.s06 = settings[5];
    self.settings.s07 = settings[6];
    self.settings.s08 = settings[7];
    self.settings.s09 = settings[8];
    self.settings.s10 = settings[9];
    self.settings.s11 = settings[10];
    self.settings.s12 = settings[11];
  }
  catch(err) {
    logger.error(err);
  }
};

MeltemCVSDevice.prototype.onD61 = function(data) {
  var self = this;

  if (!_.isString(data) || data.length !== 59) {
    logger.error('Invalid Data : ', data);
    return;
  }

  try {
    var i;
    var settings = [];

    for(i = 0; i < 12 ; i++ ) {
      settings[i]  = parseInt(data.substr(10 + i * 4, 4));
    }

    self.settings.s13 = settings[0];
    self.settings.s14 = settings[1];
    self.settings.s15 = settings[2];
    self.settings.s16 = settings[3];
    self.settings.s17 = settings[4];
    self.settings.s18 = settings[5];
    self.settings.s19 = settings[6];
    self.settings.s20 = settings[7];
    self.settings.s21 = settings[8];
    self.settings.s22 = settings[9];
    self.settings.s23 = settings[10];
    self.settings.s24 = settings[11];
  }
  catch(err) {
    logger.error(err);
  }
};

function CreateInstance(master, id) {
   var  instance;

   instance = new MeltemCVSDevice(master, id);

   return instance;
 }

module.exports = {
   create: CreateInstance
 }; 