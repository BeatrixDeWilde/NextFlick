var port = 8080;
var express = require('express');
var app     = express();
var http    = require('http');
var server  = http.createServer(app);
var io      = require('socket.io').listen(server);
var request = require('request');
var api_param = 'api_key=a91369e1857e8c0cf2bd02b5daa38260';

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
    getRandomFilmImageURL();
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
          socket.emit('correct_login');
        }
        client.end();
      });
    });
  });

// Get random film from movie database API
// Thriller genre: 'http://api.themoviedb.org/3/genre/53/movies'
// Base image url: 'http://image.tmdb.org/t/p/w500'
function getRandomFilmImageURL() {
  request({
  method: 'GET',
  url: 'http://api.themoviedb.org/3/movie/popular' + '?' + api_param + '&page=1',
  headers: {
    'Accept': 'application/json'
  }}, 
  function (error, response, body) {
    if (response.statusCode === 200) {
      var response = JSON.parse(body);
      var res_len = response.results.length;
      var rand_index = Math.floor(Math.random() * res_len);
      var img_url_extension = response.results[rand_index].poster_path;
      var img_url = 'http://image.tmdb.org/t/p/w500' + img_url_extension;
    }
    socket.emit('new_film', img_url);
  });
}
});
