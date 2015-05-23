var port = 8080;
var express = require('express');
var app     = express();
var http    = require('http');
var server  = http.createServer(app);
var io      = require('socket.io').listen(server);

server.listen(port);

var users = {};
var guest = 0;

app.get('/create/', function(req, res) {
  res.sendFile(__dirname + '/create.html');
});

app.get('/room/*', function(req, res) {
  res.sendFile(__dirname + '/page.html');
});

app.get('', function(req, res) {
  res.sendFile(__dirname + '/login.html');
});

io.sockets.on('connection', function(socket) {

  socket.on('user_join', function(username, channel) {
    if (username == 'guest') {
      guest++; // TODO amount in total
      username = username + guest;
    }
    socket.username = username;
    socket.channel = channel;
    users[username] = username;
    socket.join(channel);
    socket.emit('update_chat', 'SERVER', 'Connected to channel ' + channel);
    socket.broadcast.to(socket.channel).emit('update_chat', 'SERVER', username + ' has joined the channel');
    io.sockets.in(socket.channel).emit('update_user_list', users);
  });

  socket.on('disconnect', function() {
    delete users[socket.username];
    socket.broadcast.to(socket.channel).emit('update_chat', 'SERVER', socket.username + ' has left the channel');
    io.sockets.in(socket.channel).emit('update_user_list', users);
    socket.leave(socket.room);
  });

  socket.on('choice', function(decision) {
    //TODO
    // socket.emit('new_film', etc);
  });

  // At the moment gets the user from the database 
  // and returns the password should be be somewhere else?
  socket.on('login', function(username) {
    var pg = require("pg");
    var con = "pg://g1427106_u:mSsFHJc6zU@db.doc.ic.ac.uk:5432/g1427106_u";
    pg.connect(con, function(err, client, done) {
      if(err) {
        return console.error('error connecting', err);
      }
      client.query('SELECT * FROM users WHERE username = $1', [username], function(err, result) {
        done();
        if(err) {
          return console.error('error running query', err);
        }
        socket.emit('logged_in',result.rows[0].password);
        client.end();
      });
    });
  });
});
