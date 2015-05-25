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
var num_users = 0;

app.get('/room/*', function(req, res) {
   res.sendFile(__dirname + '/channel.html');
});

io.sockets.on('connection', function(socket) {

  getNumPopularFilms(40);
  socket.emit('initialise', films);
   
  socket.on('user_join', function(username, channel) {
    socket.username = username;
	  socket.channel = channel;
	  users[username] = username;
	  socket.join(channel);
    ++num_users;
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
  --num_users;
  });
  socket.on('choice', function(decision) {
    //getRandomFilmImageURL(decision);
    socket.emit('new_films', films, decision);
  });

  socket.on('increment_yes', function(index) {
    console.log('Check if done. Num: ' + index);
    films[index].yes_count++;
    console.log(films[index].yes_count + ' vs ' + num_users);
    if (films[index].yes_count >= num_users) {
        io.sockets.in(socket.channel).emit('film_found', films[index]);
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

// numFilms parameter to specify how many films to put in list
// numFilms must be a multiple of 20
function getNumPopularFilms(numFilms) {
  var numRequests = Math.floor(numFilms / 20);
  if (numRequests > 0) {
    for (var i = 1; i <= numRequests; i++) {
      get20PopularFilms(i);
    }
  }
}

/* Get 20 popular films from page number pageNum and append them to the list
   of films */
function get20PopularFilms(pageNum) {
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
    if (films.length == 0) {
      films = film_list;
    } else {
      films.push.apply(films, film_list);
    }
    //console.log(films); // print out films to see how often being queried
    // TODO: films are being queried again each time a user joins the same room
    // Need to make list of films local to room

//    socket.emit('new_films', film_list);
  });
}

});
