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
var films = [];
var num_users = [];
var queryDelayBuffer = 10;

app.get('/room/*', function(req, res) {
   res.sendFile(__dirname + '/client.html');
});

io.sockets.on('connection', function(socket) {

//  getNumPopularFilms(40);
//  socket.emit('initialise', films);
   
  socket.on('user_join', function(username, channel) {
    socket.username = username;
	  socket.channel = channel;
    if (typeof users[channel] === 'undefined') {
      users[channel] = {};
      num_users[channel] = 0;
      films[channel] = [];
      // Initialise film list with results from page 1
      add20PopularFilms(1, channel);
      console.log(films[channel]);
      //socket.emit('initialise', films[channel]);
    } else {
      socket.emit('initialise', films[channel][0]);
    }
	  users[channel][username] = username;
	  socket.join(channel);
    ++num_users[channel];
    socket.emit('update_chat', 'SERVER', 'Connected to channel ' + channel);
	  socket.broadcast.to(socket.channel).emit('update_chat', 'SERVER', username + ' has joined the channel');
    io.sockets.in(socket.channel).emit('update_user_list', users[channel]);
   });
  
  socket.on('send_message', function(message) {
	  socket.emit('update_chat', 'You', message);
  	socket.broadcast.to(socket.channel).emit('update_chat', socket.username, message);
//	io.sockets.in(socket.channel).emit('update_chat', socket.username, message);
  });

  socket.on('disconnect', function() {
    if (typeof socket.username !== 'undefined') {
	    delete users[socket.channel][socket.username];
	    socket.broadcast.to(socket.channel).emit('update_chat', 'SERVER', socket.username + ' has left the channel');
	    io.sockets.in(socket.channel).emit('update_user_list', users);
	    socket.leave(socket.room);
      --num_users[socket.channel];
      console.log('DEBUG: ' + socket.username + ' has left randomly!');
  }
  });
  socket.on('choice', function(decision, index) {
    var message = ' said ' + decision + ' to movie: ' + films[socket.channel][index - 1].title;
	  socket.emit('update_chat', 'You', message);
  	socket.broadcast.to(socket.channel).emit('update_chat', socket.username, message);
    var curNumFilms = films[socket.channel].length;
    if (index == (curNumFilms - queryDelayBuffer)) {
      var nextPage = Math.floor(index / 20) + 2;
      add20PopularFilms(nextPage, socket.channel);
    }
    socket.emit('new_films', films[socket.channel][index]);
  });

  socket.on('increment_yes', function(index) {
    console.log('Check if done. Num: ' + index);
    films[socket.channel][index].yes_count++;
    console.log(films[socket.channel][index].yes_count + ' vs ' + num_users[socket.channel]);
    if (films[socket.channel][index].yes_count >= num_users[socket.channel]) {
        io.sockets.in(socket.channel).emit('film_found', films[socket.channel][index]);
    }
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

// Get random film from movie database API
// Thriller genre: 'http://api.themoviedb.org/3/genre/53/movies'
// Base image url: 'http://image.tmdb.org/t/p/w500'
// Image sizes: w185, w342, w500, w780 (smallest to largest)
function getRandomFilmImageURL(decision) {
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
    socket.broadcast.to(socket.channel).emit('update_chat', 'SERVER', socket.username + ' next film to ' + response.results[rand_index].title);
  });
}

/* Get 20 popular films from page number pageNum and append them to the list
   of films */
function add20PopularFilms(pageNum, channel) {
  // Only query within range 0 < n <= 1000, otherwise default query page 1
  if (pageNum == 0 || pageNum > 1000) {
    pageNum = 1;
  }
  request({
  method: 'GET',
  url: 'http://api.themoviedb.org/3/movie/popular' + '?' + api_param + '&page=' + pageNum,
  headers: {
    'Accept': 'application/json'
  }}, 
  function (error, response, body) {
    if (response.statusCode === 200) {
      var response = JSON.parse(body);
      var film_list = response.results;
      for (var i = 0, len = film_list.length; i < len; i++) {
        film_list[i].poster_path = 'http://image.tmdb.org/t/p/w342' + film_list[i].poster_path;
        delete film_list[i].backdrop_path;
        delete film_list[i].video;
        delete film_list[i].vote_average;
        delete film_list[i].vote_count;
        film_list[i].yes_count = 0;
      }
    }
    // append films to JSON films array
    if (films[channel].length == 0) {
      films[channel] = film_list;
      socket.emit('initialise', films[channel][0]);
    } else {
      films[channel].push.apply(films[channel], film_list);
    }
    for (var i = 0, len = films[channel].length; i < len; i++) {
      console.log('Film ' + i + ':> ' + films[channel][i].title);
    }

//    socket.emit('new_films', film_list);
  });
}

});
