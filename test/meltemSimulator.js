var net = require('net');

var client = new net.Socket();
client.connect(9000, '10.0.1.1', function() {
	console.log('Connected');
});

client.on('data', function(data) {
	var frame = new Buffer(data).toString().replace(/[\n\r]+/g,'');
	console.log('Received: ' + frame);
	if (frame.length == 9) {
		deviceId = frame.substr(0, 3);
		cmd = frame.substr(6, 3);

		console.log('Device Id : ', deviceId);
		console.log('Command : ', cmd);
	}
});

client.on('close', function() {
	console.log('Connection closed');
});


