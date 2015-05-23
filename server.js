var port = 8080;
var express = require('express');
var app     = express();
var http    = require('http');
var server  = http.createServer(app);
var io      = require('socket.io').listen(server);

server.listen(port);

var users = {};
var guest = 0;

app.get('/create/*', function(req, res) {
  res.sendFile(__dirname + '/create.html');
});

app.get('/room/*', function(req, res) {
  res.sendFile(__dirname + '/page.html');
});

app.get('', function(req, res) {
  res.sendFile(__dirname + '/login.html');
});

io.sockets.on('connection', function(socket) {

  socket.on('room_join', function(channel) {
    username = socket.username ;
    socket.channel = channel;
    socket.join(channel);
  });

  socket.on('user_join', function(username) {
    if (username == 'guest') {
      guest++; // TODO amount in total
      username = username + guest;
    }
    socket.username = username;
    users[username] = username;
  });

  socket.on('disconnect', function() {
    delete users[socket.username];
    socket.leave(socket.room);
  });

  socket.on('test', function(decision) {
    socket.emit('testClient', socket.username, socket.channel);
  });

  socket.on('choice', function(decision) {
    //TODO
    socket.emit('new_film', url);
  });

  // At the moment gets the user from the database 
  // and returns the password should be be somewhere else?
  socket.on('login', function(username, password) {
    var pg = require("pg");
    var con = "pg://g1427106_u:mSsFHJc6zU@db.doc.ic.ac.uk:5432/g1427106_u";
    // This has the database password in it? 
    pg.connect(con, function(err, client, done) {
      if(err) {
        return console.error('error connecting', err);
      }
      client.query('SELECT * FROM users WHERE username = $1', [username], function(err, result) {
        // SQL injection? 
        done();
        if(err) {
          return console.error('error running query', err);
        }
        if(result.rows.length != 1){
          socket.emit('incorrect_login',"No such user");
        } 
        else if(result.rows[0].password != password)
        {
          socket.emit('incorrect_login',"Incorrect password");
        }
        else
        {
          socket.emit('correct_login',username);
        }
        client.end();
      });
    });
  });

  //socket.on('signup', function(username, password) {

  //});

});
