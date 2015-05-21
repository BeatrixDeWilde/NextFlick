var express = require('express'),
   app = express(), 
   http = require('http'),
   server = http.createServer(app),
   io = require('socket.io').listen(server);

server.listen(8080);

// Routing information
app.get('/', function(req, result) {
	result.sendFile(__dirname + '/index.html');
});

// List of Users and Rooms 
var usernames = {}, channels = {};

io.sockets.on('connection', function(socket) {

	socket.on('addUser', function(username) {

		// Add user information 
		socket.username = username;
		
		// Add list of users, do not add the room
		usernames[username] = username;

		// Join room and updated
		socket.join(socket.channel);
		socket.emit('updateChat', 'SERVER', 'Connected to room ' + socket.channel);
		// Tell other users that they have joined
		socket.broadcast.to(socket.channel).emit('updateChat', 'SERVER', username + ' has connected');
		socket.emit('updateChannels', channels, socket.channel);
		io.sockets.in(socket.channel).emit('updateUsers', username);
	});

	socket.on('sendChat', function(data) {
		io.sockets.in(socket.channel).emit('updateChat', socket.username, data);
	});


	socket.on('switchRoom', function(newChan) {
		socket.leave(socket.channel);	
		socket.broadcast.to(socket.channel).emit('updateChat', 'SERVER', socket.username + ' has left the channel');
		socket.join(newChan);
		socket.channel = newChan; 
		socket.broadcast.to(socket.channel).emit('updateChat', 'SERVER', socket.username + ' has joined the channel');
		socket.emit('updateChat', 'SERVER', 'Connected to channel ' + newChan);
	});

	socket.on('addChannel', function(channel) {
		if (typeof channels[channel] == 'undefined') {
		channels[channel] = channel;
		}
		socket.channel = channel;
	});

	socket.on('disconnect', function() {
		socket.broadcast.to(socket.channel).emit('updateChat', 'SERVER', socket.username + ' has left the channel');
		delete usernames[socket.username];
		io.sockets.emit('updateUsers', usernames);
		socket.leave(socket.channel);
	});

});





