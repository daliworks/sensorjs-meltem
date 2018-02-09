'use strict';

var util = require('util');
var EventEmitter = require('events').EventEmitter;

var SerialPort = require('serialport');
var _ = require('lodash');
var async = require('async');
var logger = require('log4js').getLogger('MELTEM');

var serialOpts = {
  baudRate: 115200,
  parity: 'none'
};

var ERROR_TEST = false;
var SERIAL_PORT_FILE = '/dev/cu.usbserial-A403BAF1';
var POLLING_INTERVAL = 10000;   // 10 secs
var RETRY_OPEN_INTERVAL = 3000; // 3 secs
var ELIMINATOR = '0D0A';
var DELIMITER = ';';

logger.setLevel('INFO');

var devices = [
  {
    receiver: 'AE999',
    sender: 'AE0001',
    sensors: [
      {
        id: '001',
        type: 'T'
      },
      {
        id: '002',
        type: 'H'
      },
      {
        id: '003',
        type: 'N'
      },
      {
        id: '004',
        type: 'D'
      },
      {
        id: '005',
        type: 'L'
      },
      {
        id: '006',
        type: 'W'
      }
    ]
  },
  {
    receiver: 'AE999',
    sender: 'AE0002',
    sensors: [
      {
        id: '001',
        type: 'T'
      },
      {
        id: '002',
        type: 'H'
      },
      {
        id: '003',
        type: 'N'
      },
      {
        id: '004',
        type: 'D'
      },
      {
        id: '005',
        type: 'L'
      },
      {
        id: '006',
        type: 'W'
      }
    ]
  }
];

function makeErrorCase(arr) {
  var result = arr;
  var rand;

  if (ERROR_TEST && arr[3] === 'T') {
    rand = _.random(0, 10);
    logger.info('random:', rand);

    switch (rand) {
    case 0:       // Too many items
      logger.warn('Too many items');
      result.unshift('DUMMY');
      break;
    case 1:       // No delimiter
      logger.warn('Missing item');
      result = [ELIMINATOR];
      break;
    case 2:       // Too long receiver node ID
      logger.warn('Too long receiver node ID');
      result[0] += 'EEE';
      break;
    case 3:       // Too long sender node ID
      logger.warn('Too long sender node ID');
      result[1] += 'EEE';
      break;
    case 4:       // Too long sensor ID
      logger.warn('Too long sensor ID');
      result[2] += 'EEE';
      break;
    case 5:       // Too long sensor type
      logger.warn('Too long sensor type');
      result[3] += 'EEE';
      break;
    case 6:       // No receiver node ID
      logger.warn('No receiver node ID');
      result[0] = '';
      break;
    case 7:       // No sender node ID
      logger.warn('No sender node ID');
      result[1] = '';
      break;
    case 8:       // No sensor ID
      logger.warn('No sensor ID');
      result[2] = '';
      break;
    case 9:       // No sensor type
      logger.warn('No sensor type');
      result[3] = '';
      break;
    case 10:      // No value
      logger.warn('No value');
      result[4] = '';
      break;
    default:
      logger.fatal('No case');
      break;
    }
  }

  return result;
}

function generateValue(receiver, sender, sensorId, sensorType) {
  var tbl = {
    T: {
      min: -20,
      max: 300,
      precision: 10
    },
    H: {
      min: 0,
      max: 100,
      precision: 10
    },
    N: {
      min: 0,
      max: 150,
      precision: 1
    },
    D: {
      min: 0,
      max: 500,
      precision: 10
    },
    L: {
      min: 0,
      max: 150000,
      precision: 1
    },
    W: {
      min: 0,
      max: 1000,
      precision: 10
    }
  };

  var arr = [
    receiver,
    sender,
    sensorId,
    sensorType
  ];

  var min = tbl[sensorType].min;
  var max = tbl[sensorType].max;
  var precision = tbl[sensorType].precision;

  arr.push(Math.round(_.random(min, max, true) * precision) / precision);
  arr.push(ELIMINATOR);
  arr = makeErrorCase(arr);

  return arr.join(DELIMITER);
}

function openSerialPort(meltem, cb) {
  var self;

  if (_.isFunction(meltem)) {
    self = module.exports;
    cb = meltem;
  } else {
    self = meltem;
  }

  self.port = new SerialPort(SERIAL_PORT_FILE, serialOpts, function onOpen(err) {
    logger.info('[Meltem] Connected');

    if (err) {
      logger.error('Serial port error during opening:', err);

      return cb && cb(err);
    } else {
      logger.info('[Meltem] No err, Connected');
    }

    self.port.on('error', function onError(err) {
      logger.error('Serial port error:', err);

      return;
    });

    self.port.on('close', function onError(err) {
      if (err) {
        logger.error('Serial port error during closing:', err);
        // TODO: if error, isn't this closed?
      } else {
        logger.info('Serial port is closed');
      }

      return;
    });

    self.port.on('disconnect', function onError(err) {
      logger.error('Serial port is disconnected:', err);

      return;
    });

    self.isOpen = true;

    self.port.on('data', function onData(data) {
      logger.trace('[Meltem] onData():', new Buffer(data).toString());
    });

    self.startPolling();
  });
}

function openSerialCallback(/*err*/) {
  setTimeout(function () {
    openSerialPort(openSerialCallback);
  }, RETRY_OPEN_INTERVAL);
}

// TODO: If opening port takes long time, async function cannot be finished.
function Meltem () {
  var self = this;

  EventEmitter.call(self);

  self.timer = null;

  openSerialPort(self, openSerialCallback);
}

util.inherits(Meltem, EventEmitter);

Meltem.prototype.startPolling = function () {
  var self = this;

  if (!self.timer) {
    self.timer = setInterval(function () {
      async.eachSeries(devices, function (device, done) {
        async.eachSeries(device.sensors, function (sensor, done2) {
          var msg = generateValue(device.receiver, device.sender, sensor.id, sensor.type);

          logger.info(msg, self.port.isOpen());
          self.port.write(msg, function (err) {
            if (err) {
              logger.error('Write Error:', err);
            } else {
              logger.trace('Write Done');
            }

            self.port.drain(function (err2) {
              if (err2) {
                logger.error('Drain Error:', err2);
              } else {
                logger.trace('Drain Done');
              }

              done2(err);
            });
          });
        }, function (err) {
          done(err);
        });
      });
    }, POLLING_INTERVAL);
  }
};

Meltem.prototype.stopPolling = function () {
  if (this.timer) {
    clearInterval(this.timer);
    this.timer = null;
  }
};

Meltem.prototype.close = function () {
  logger.info('Closing serial port');
  this.port.close();
};

module.exports = new Meltem();
