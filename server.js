var port = 8080;
var express = require('express');
var app     = express();
var http    = require('http');
var server  = http.createServer(app);
var io      = require('socket.io').listen(server);

server.listen(port);

var users = {};

app.get('/room/*', function(req, res) {
   res.sendFile(__dirname + '/channel.html');
});

io.sockets.on('connection', function(socket) {
   
   socket.on('user_join', function(username, channel) {
	socket.username = username;
	socket.channel = channel;
	users[username] = username;
	socket.join(channel);
	 socket.emit('update_chat', 'SERVER', 'Connected to channel ' + channel);
	socket.broadcast.to(socket.channel).emit('update_chat', 'SERVER', username + ' has joined the channel');
        io.sockets.in(socket.channel).emit('update_user_list', users);
   });
  
  socket.on('send_message', function(message) {
	socket.emit('update_chat', 'You', message);
	socket.broadcast.to(socket.channel).emit('update_chat', socket.username, message);
//	io.sockets.in(socket.channel).emit('update_chat', socket.username, message);
  });

  socket.on('disconnect', function() {
	delete users[socket.username];
	socket.broadcast.to(socket.channel).emit('update_chat', 'SERVER', socket.username + ' has left the channel');
	io.sockets.in(socket.channel).emit('update_user_list', users);
	socket.leave(socket.room);
  });

});
