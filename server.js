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
var guest = 0;
var locks = {};

// Genre IDs for movie queries
var genreIdLookup = {
  "Action" : 28,
  "Adventure" : 12,
  "Animation" : 16,
  "Comedy" : 35,
  "Crime" : 80,
  "Documentary" : 99,
  "Drama" : 18,
  "Family" : 10751,
  "Fantasy" : 14,
  "Foreign" : 10769,
  "History" : 36,
  "Horror" : 27,
  "Music" : 10402,
  "Mystery" : 9648,
  "Romance" : 10749,
  "Science Fiction" : 878,
  "TV Movie" : 10770,
  "Thriller" : 53,
  "War" : 10752,
  "Western" : 37
}
var query_genres = ["Horror","Romance","Thriller"];

app.use(express.static(__dirname + '/public'));

app.get('/', function(req, res) {
   res.sendFile(__dirname + '/index.html');
});

io.sockets.on('connection', function(socket) {

//  getNumPopularFilms(40);
//  socket.emit('initialise', films);

 socket.on('new_room', function() {
     // TODO: Random Room ID Generator, just using guest for now
     var channel = guest++;
     socket.channel = channel;
     users[channel] = {};
     num_users[channel] = 0;
     films[channel] = [];
     // Initialise film list with results from page 1
     //add20PopularFilms(1, channel);
     add20FilmsByGenre(1, channel, query_genres);
     console.log(films[channel]);
     //socket.emit('initialise', films[channel]);
     socket.emit('set_room_id', channel);
  });
 
  socket.on('get_guest_id', function() {
     var username = 'guest';
     guest++;
     username += guest;
     socket.emit('set_username', username);
  });
   
  socket.on('user_join', function(username, channel) {
    socket.username = username;
	  socket.channel = channel;
    if (locks[channel] == true) {
      socket.emit('room_is_locked');
    } else if (typeof users[channel] === 'undefined') {
      socket.emit('room_not_initialised');
    } else {
      socket.emit("joined_room", channel);
      socket.emit('initialise', films[channel][0]);
  	  users[channel][username] = username;
  	  socket.join(channel);
      ++num_users[channel];
      socket.emit('update_chat', 'SERVER', 'Connected to channel ' + channel);
  	  socket.broadcast.to(socket.channel).emit('update_chat', 'SERVER', username + ' has joined the channel');
      io.sockets.in(socket.channel).emit('update_user_list', users[channel]);
    }
   });
  
  socket.on('send_message', function(message) {
	  socket.emit('update_chat', 'You', message);
  	socket.broadcast.to(socket.channel).emit('update_chat', socket.username, message);
//	io.sockets.in(socket.channel).emit('update_chat', socket.username, message);
  });

  socket.on('leave_room', function(username, room) {
     if (typeof socket.username !== 'undefined') {
            delete users[socket.channel][socket.username];
            socket.broadcast.to(socket.channel).emit('update_chat', 'SERVER', socket.username + ' has left the channel');
            io.sockets.in(socket.channel).emit('update_user_list', users);
            socket.leave(socket.room);
      --num_users[socket.channel];
      //console.log('DEBUG: ' + socket.username + ' has left randomly!');
      if (num_users[socket.channel] == 0) {
          console.log('Tear down room: ' + socket.channel);
          delete users[socket.channel];
          locks[socket.channel] = false;
      }
    }
  });

  socket.on('disconnect', function() {
    if (typeof socket.username !== 'undefined' && typeof socket.channel !== 'undefined' 
        && typeof users[socket.channel] !== 'undefined') {
	    delete users[socket.channel][socket.username];
	    socket.broadcast.to(socket.channel).emit('update_chat', 'SERVER', socket.username + ' has left the channel');
	    io.sockets.in(socket.channel).emit('update_user_list', users);
	    socket.leave(socket.room);
      --num_users[socket.channel];
      //console.log('DEBUG: ' + socket.username + ' has left randomly!');
      if (num_users[socket.channel] == 0) {
          console.log('Tear down room: ' + socket.channel);
          delete users[socket.channel];
      }
    } 
  });
  socket.on('choice', function(decision, index) {
    var message = ' said ' + decision + ' to movie: ' + films[socket.channel][index - 1].title;
	  socket.emit('update_chat', 'You', message);
  	socket.broadcast.to(socket.channel).emit('update_chat', socket.username, message);
    var curNumFilms = films[socket.channel].length;
    if (index == (curNumFilms - queryDelayBuffer)) {
      var nextPage = Math.floor(index / 20) + 2;
      //add20PopularFilms(nextPage, socket.channel);
      add20FilmsByGenre(nextPage, socket.channel, query_genres);
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
 
  socket.on('force_go_signal', function(room) {
    locks[room] = true;
    socket.broadcast.to(room).emit('force_go');
  });

  socket.on('sign_in', function(username, password) {
    var pg = require("pg");
    var con = "pg://g1427106_u:mSsFHJc6zU@db.doc.ic.ac.uk:5432/g1427106_u";
    pg.connect(con, function(err, client, done) {
      if(err) {
        return console.error('error connecting', err);
      }
      client.query('SELECT * FROM users WHERE username = $1', [username], function(err, result) {
        //done(); ??
        if(err) {
          return console.error('error running query', err);
        }
        if(result.rows.length != 1){
          socket.emit('incorrect_login',"No such user", false);
        } 
        else if(result.rows[0].password != password)
        {
          socket.emit('incorrect_login',"Incorrect password", true);
        }
        else
        {
          socket.emit('correct_login',username);
        }
        client.end();
      });
    });
  });


  socket.on('sign_up', function(username, password) {
    var pg = require("pg");
    var con = "pg://g1427106_u:mSsFHJc6zU@db.doc.ic.ac.uk:5432/g1427106_u";
    pg.connect(con, function(err, client, done) {
      if(err) {
        return console.error('error connecting', err);
      }
      client.query('SELECT * FROM users WHERE username = $1', [username], function(err, result) {
        if(err) {
          return console.error('error running query', err);
        }
        if(result.rows.length != 0 || /^(guest)/.test(username)){
          socket.emit('user_already_exists', username);
        } 
        else
        {
          insert_user(username, password);
          socket.emit('signed_in', username);
        }
        client.end();
      });
    });
  });

function insert_user (username, password) {
  var pg = require("pg");
  var con = "pg://g1427106_u:mSsFHJc6zU@db.doc.ic.ac.uk:5432/g1427106_u";
  pg.connect(con, function(err, client, done) {
    if(err) {
      return console.error('error connecting', err);
    }
    client.query('INSERT INTO users(username, password) values($1,$2);', [username, password], function(err, result) {
      if(err) {
        return console.error('error running query', err);
      }
      client.end();
    });
  });
}

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
  url: 'http://api.themoviedb.org/3/movie/popular?' + api_param + '&page=' + pageNum,
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
    
      // append films to JSON films array
      if (films[channel].length == 0) {
        films[channel] = film_list;
        socket.emit('initialise', films[channel][0]);
      } else {
        films[channel].push.apply(films[channel], film_list);
      }
      /*for (var i = 0, len = films[channel].length; i < len; i++) {
        console.log('Film ' + i + ':> ' + films[channel][i].title);
      }*/
    }

  });
}

/* Get 20 films of all genres from the array parameter 'genres' 
   from page number pageNum and append them to the list of films */
function add20FilmsByGenre(pageNum, channel, genres) {
  // Only query within range 0 < n <= 1000, otherwise default query page 1
  if (pageNum == 0 || pageNum > 1000) {
    pageNum = 1;
  }
  // Prepare genre IDs for query
  var genreParams = '';
  if (genres.length != 0) {
    for (var i = 0, len = genres.length; i < len; i++) {
      genreParams += genreIdLookup[genres[i]];
      if (i != (len - 1)) {
        genreParams += '|';
      }
    }
  }
  request({
    method: 'GET',
    url: 'http://api.themoviedb.org/3/discover/movie?' + api_param + 
         '&page=' + pageNum + 
         '&include_adult=false' + 
         '&sort_by=popularity.desc' + 
         '&with_genres=' + genreParams,
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
    
        // append films to JSON films array
        if (films[channel].length == 0) {
          films[channel] = film_list;
          socket.emit('initialise', films[channel][0]);
        } else {
          films[channel].push.apply(films[channel], film_list);
        }
    }
  
  });  
}

});
