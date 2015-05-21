var express = require('express');
var app     = express();
var http    = require('http');
var server  = http.createServer(app);
var io      = require('socket.io').listen(server);

server.listen(8080);

// Routing information
app.get('/', function(requ, result) {
	result.sendFile(__dirname + '/index.html');
});

// List of Users and Channels
var usernames = {}, channels = {};

io.sockets.on('connection', function(socket) {

	socket.on('addChannel', function(id) {
		if (typeof channels[id] == 'undefined') {
			var channel = {id:id, users:{}};
			channels[id] = channel;
			socket.emit('updateChannels', channels);
			socket.channel = channel;
		} else {
			socket.channel = channels[id];
		}

	});

	socket.on('addUser', function(username) {
		socket.username = username;
		var user = {username:username}
		socket.channel.users[username] = user;

		socket.join(socket.channel);
		socket.emit('updateChat', 'SERVER', 'Connected to channel ' + socket.channel.id);
		socket.broadcast.to(socket.channel).emit('updateChat', 'SERVER', username + ' has joined channel ' + socket.channel.id);

		io.sockets.in(socket.channel).emit('updateUsers', socket.channel.users);

	});

	socket.on('sendChat', function(text) {
		io.sockets.in(socket.channel).emit('updateChat', socket.username, text);
	});

});
