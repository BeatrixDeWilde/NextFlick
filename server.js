var port = 8080;
var express = require('express');
var app     = express();
var http    = require('http');
var server  = app.listen(port);
//var server  = http.createServer(app);
var io      = require('socket.io').listen(server);
var request = require('request');
var api_param = 'api_key=a91369e1857e8c0cf2bd02b5daa38260';
var bcrypt = require('bcrypt-nodejs');
var pg = require("pg");
var post_database = "pg://g1427106_u:mSsFHJc6zU@db.doc.ic.ac.uk:5432/g1427106_u";
// Internal memory cache
var NodeCache = require("node-cache");
var filmInfoCache = new NodeCache({stdTTL: 86400, useClones: true});


server.listen(port);

var users = {};
var films = [];
var num_users = [];
var query_collection_count = {};
/* Stores a boolean for each channel to indicate if there is already a 
   request in progress for the next batch of films (prevents race conditions) */
var request_in_progress = {};
// Has to be greater than 0 and less than the number of films in each batch
var queryDelayBuffer = 10;
var queryBatchSize = 20; 
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
  "Sci-Fi" : 878,
  "TV_Movie" : 10770,
  "Thriller" : 53,
  "War" : 10752,
  "Western" : 37
}

var query_genres = [];
var dateToday = (new Date()).toISOString().substring(0,10);

app.use(express.static(__dirname + '/public'));

app.get('/', function(req, res) {
   res.sendFile(__dirname + '/index.html');
});

io.sockets.on('connection', function(socket) {
 
  console.log('Obtained connection');

  socket.on('new_room', function() {
     // TODO: Random Room ID Generator, just using guest for now
     var channel = guest++;
     socket.channel = channel;
     users[channel] = {};
     num_users[channel] = 0;
     films[channel] = [];
     query_genres[channel] = [];
     query_collection_count[channel] = [];
     request_in_progress[channel] = false;
     socket.emit('set_room_id', channel);
  });
 
  socket.on('user_add_genres', function(genres) {
     query_genres[socket.channel] = query_genres[socket.channel].concat(genres);
     ++query_collection_count[socket.channel];
     if (query_collection_count[socket.channel] >= num_users[socket.channel]) {
        console.log('All users have voted. Should fire off only once!');
        //TODO:  request_in_progress[socket.channel] = true; // not sure if need
        generate_films(socket.channel);
     } 
  });

  function generate_films(room) {
    console.log('Generating films for room ' + room + ' of genres: ' + query_genres[room]);
    // Initialise film list with results from page 1
    // This function now calls back to show the film pages once done
    add20FilmsByGenre(1, room, query_genres[room]);
    //io.sockets.in(room).emit('initialise', films[room][0]);

  }

  socket.on('generate_films', function(room, genres) {
    console.log('DEPRECATED: socket on generate_films');
    query_genres[room] = genres;
    console.log('Generating films for room ' + room + ' of genres: ' + query_genres[room]);
    // Initialise film list with results from page 1
    // This function now calls back to show the film pages once done
    add20FilmsByGenre(1, room, query_genres[room]);
    //io.sockets.in(room).emit('initialise', films[room][0]);
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
      //socket.emit('initialise', films[channel][0]);
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
  });

  socket.on('leave_room', function(username, room) {
	  socket.leave(room);
    console.log(username + ' is leaving room ' + room);
    free_resources();
  });

  socket.on('disconnect', function() {
    console.log(socket.username + ' has disconnected from room ' + socket.channel);
    free_resources();
  });

  function free_resources() {
    if (typeof socket.username !== 'undefined' && typeof socket.channel !== 'undefined'
        && typeof users[socket.channel] !== 'undefined') {
      delete users[socket.channel][socket.username];
      socket.broadcast.to(socket.channel).emit('update_chat', 'SERVER', socket.username + ' has left the channel');
      io.sockets.in(socket.channel).emit('update_user_list', users[socket.channel]);
      socket.leave(socket.room);
      --num_users[socket.channel];
      if (num_users[socket.channel] == 0) {
        console.log('Tear down room: ' + socket.channel);
        delete users[socket.channel];
        delete films[socket.channel];
        delete query_collection_count[socket.channel];
        delete request_in_progress[socket.channel];
        delete query_genres[socket.channel];
      }
    }

  }
  
  socket.on('choice', function(decision, index, inc) {
    // if statement checks that next film and extra information is ready 
    if (typeof films[socket.channel][index+1] !== 'undefined'
        && typeof films[socket.channel][index+1].shortPlot !== 'undefined'
        && typeof films[socket.channel][index+1].runtime !== 'undefined') {
      if(inc){
        films[socket.channel][index].yes_count++;
        console.log(films[socket.channel][index].yes_count + ' vs ' + num_users[socket.channel]);
      }
      if (films[socket.channel][index].yes_count >= num_users[socket.channel]) {
        io.sockets.in(socket.channel).emit('film_found', films[socket.channel][index]);
        locks[socket.channel] = false;
      } else {
        index++;
        var message = ' said ' + decision + ' to movie: ' + films[socket.channel][index-1].title;
    	  socket.emit('update_chat', 'You', message);
      	socket.broadcast.to(socket.channel).emit('update_chat', socket.username, message);
        if (index == (films[socket.channel].length - queryDelayBuffer) 
            && !request_in_progress[socket.channel]) {
          request_in_progress[socket.channel] = true;
          var nextPage = Math.floor(index / queryBatchSize) + 2;
          add20FilmsByGenre(nextPage, socket.channel, query_genres[socket.channel]);
        }
        socket.emit('new_films', films[socket.channel][index], index);
      }
    } 
  });
 
  socket.on('go_signal', function(room) {
    locks[room] = true;
    io.sockets.in(room).emit('waiting_signal');
  });
 
  socket.on('force_leave_signal', function(room) {
    console.log('Admin has left room ' + room);
    socket.broadcast.to(room).emit('force_leave');
  });

/**** Deleting a user: DELETE FROM users WHERE username = 'user9';****/

  socket.on('sign_in', function(username, password) {
    get_user_data(username, password, 'NOTSET', 'NOTSET', sign_in);
  });

  function sign_in(username, password, email, new_password, result){
    if(result.rows.length != 1) {
      socket.emit('incorrect_login',"No such user", false);
      return;
    }
    if(!bcrypt.compareSync(password,result.rows[0].password)) {
      socket.emit('incorrect_login', "Incorrect password",true);
    }
    else {
      console.log("User " + username + " chosen genres " + result.rows[0].genres);
      socket.emit('correct_login',username, result.rows[0].genres, result.rows[0].email);
    }
  }

  function get_user_data(username, password, email, new_password, func){
    pg.connect(post_database, function(err, client, done) {
      if(err) {
        return console.error('error connecting', err);
      }

      client.query('SELECT * FROM users WHERE username = $1', [username], function(err, result) {
        if(err) {
          return console.error('error running query', err);
        }
        func(username, password, email, new_password, result);
        client.end();
      });
    });
  }

  socket.on('change_settings', function(username, genres) {
    pg.connect(post_database, function(err, client, done) {
      if(err) {
        return console.error('error connecting', err);
      }
      client.query('UPDATE users SET genres=$2 WHERE username=$1;', [username,genres], function(err, result) {
        if(err) {
          return console.error('error running query', err);
        }
        client.end();
      });
    });
  });

  function check_old_password(username, password, email, new_password, result){
    if(result.rows.length != 1) {
      socket.emit('incorrect_input',"No such user");
    } else if(!bcrypt.compareSync(password,result.rows[0].password)) {
      socket.emit('incorrect_input', "Incorrect password");
    }
    else {
      insert_new_password(username, new_password);
    }
  }

  function insert_new_password (username, new_password) {
    pg.connect(post_database, function(err, client, done) {
      if(err) {
        return console.error('error connecting', err);
      }
      client.query('UPDATE users SET password=$2 WHERE username=$1;', [username,new_password], function(err, result) {
        if(err) {
          return console.error('error running query', err);
        }
        socket.emit('changed_password');
        client.end();
      });
    });
  }

  socket.on('change_password', function(id, username, old_password, new_password) {
    // TODO verify ID
    var salt = bcrypt.genSaltSync();
    var hash = bcrypt.hashSync(new_password, salt);
    get_user_data(username, old_password, 'NOTSET', hash, check_old_password);
  });

  function sign_up(username, password, email, new_password, result){
    if(result.rows.length != 0 || /^(guest)/.test(username)){
      socket.emit('user_already_exists', username);
    } 
    else
    {
      var salt = bcrypt.genSaltSync();
      var hash = bcrypt.hashSync(password, salt);
      insert_user(username, hash, email);
      socket.emit('signed_in', username, email);
    }
  }

  socket.on('sign_up', function(username, password, email) {
    get_user_data(username, password, email, 'NOTSET', sign_up);
  });

function insert_user (username, password, email) {
  pg.connect(post_database, function(err, client, done) {
    if(err) {
      return console.error('error connecting', err);
    }
    client.query('INSERT INTO users(username, password, genres, email) values($1,$2,$3,$4);', [username, password, "{}",email], function(err, result) {
      if(err) {
        return console.error('error running query', err);
      }
      client.end();
    });
  });
}

// Thriller genre: 'http://api.themoviedb.org/3/genre/53/movies'
// Base image url: 'http://image.tmdb.org/t/p/w500'
// Image sizes: w185, w342, w500, w780 (smallest to largest)
/* Get 20 films of all genres from the array parameter 'genres' 
   from page number pageNum and append them to the list of films */
function add20FilmsByGenre(pageNum, channel, genres) {
  console.log('add20Films: Adding 20 films of genres: ' + genres);
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
  console.log('Sending request: ' + genreParams);
  request({
    method: 'GET',
    url: 'http://api.themoviedb.org/3/discover/movie?' + api_param + 
         '&page=' + pageNum + 
         '&include_adult=false' + 
         '&sort_by=popularity.desc' + 
         '&release_date.lte=' + dateToday +
         '&with_genres=' + genreParams,
    headers: {
      'Accept': 'application/json'
    }}, 
    function (error, response, body) {
      if (!error && response.statusCode == 200) {
        var response = JSON.parse(body);
        var film_list = response.results;

        // append films to JSON films array
        var oldLength = films[channel].length;
        if (oldLength == 0) {
          films[channel] = shuffle(film_list);
        } else {
          films[channel].push.apply(films[channel], shuffle(film_list));
        }
        request_in_progress[channel] = false;

        for (var i = oldLength, len = oldLength + film_list.length; i < len; i++) {
          /* Update films information by modifying required properties
             and deleting unnecessary ones */
          films[channel][i].poster_path = 'http://image.tmdb.org/t/p/w342' + films[channel][i].poster_path;
          delete films[channel][i].overview;
          delete films[channel][i].backdrop_path;
          delete films[channel][i].video;
          delete films[channel][i].vote_average;
          delete films[channel][i].vote_count;
          films[channel][i].yes_count = 0;

          var filmId = films[channel][i].id;
          // Check if extra film info is in cache
          filmInfoCache.get(filmId, function(err, filmInfo) {
            if (!err) {
              if (filmInfo == undefined) {
                // Cache miss so bring film info into cache & update films
                addExtraFilmInfo(i, channel); 
              } else {
                //console.log("######### CACHE HIT #########");
                //console.log('For film ' + films[channel][i].title);

                // Cache hit so update film information with cached film info
                films[channel][i].shortPlot = filmInfo.info["Plot"];
                films[channel][i].rated = filmInfo.info["Rated"];
                films[channel][i].imdbRating = filmInfo.info["imdbRating"];
                films[channel][i].metascore = filmInfo.info["Metascore"];
                films[channel][i].tomatoRating = filmInfo.info["tomatoMeter"];
                films[channel][i].runtime = filmInfo.info["Runtime"];

                if (i == 0) {
                  initFilmPage(channel);
                }
              }
            }  
          });

        }
    }
  
  });  
}

// Shuffling algorithm

function shuffle(o) {
	for(var j, x, i = o.length; i; j = parseInt(Math.random() * i), x = o[--i], o[i] = o[j], o[j] = x);
	return o;
}


// Query OMDb API for extra film information (plot, runtime, rating etc.)
function addExtraFilmInfo(film_index, channel) {
  var encTitle = encodeURIComponent(films[channel][film_index].title);
  request({
    method: 'GET',
    url: 'http://www.omdbapi.com/?' +
         't=' + encTitle +
         '&plot=short' +
         '&r=json' +
         '&tomatoes=true', 
    headers: {
      'Accept': 'application/json'
    }}, 
    function (error, response, body) {
      if (!error && response.statusCode == 200) {
        var infoResponse = JSON.parse(body);

        // Create cache JSON object to store
        var filmId = films[channel][film_index].id;
        var filmInfo = {};
        if (infoResponse.Response === 'True') {
          filmInfo = {"info": {
                                "Plot": infoResponse["Plot"],
                                "Rated": infoResponse["Rated"],
                                "imdbRating": infoResponse["imdbRating"],
                                "Metascore": infoResponse["Metascore"],
                                "tomatoMeter": infoResponse["tomatoMeter"],
                                "Runtime": infoResponse["Runtime"]
                              }
                     };
          
        } else {
          filmInfo = {"info": {
                                "Plot": "N/A",
                                "Rated": "N/A",
                                "imdbRating": "N/A",
                                "Metascore": "N/A",
                                "tomatoMeter": "N/A",
                                "Runtime": "N/A"
                              }
                     };

        }

        // Add extra film info object to cache
        filmInfoCache.set(filmId, filmInfo, function(err, success) {
          if (!err && success) {
            //console.log('Film ' + films[channel][film_index].title + ' successfully added to cache');
          }
        });
        
        // Update films with extra film information
        films[channel][film_index].shortPlot = filmInfo.info["Plot"];
        films[channel][film_index].rated = filmInfo.info["Rated"];
        films[channel][film_index].imdbRating = filmInfo.info["imdbRating"];
        films[channel][film_index].metascore = filmInfo.info["Metascore"];
        films[channel][film_index].tomatoRating = filmInfo.info["tomatoMeter"];
        films[channel][film_index].runtime = filmInfo.info["Runtime"];
        
        if (film_index == 0) {
          initFilmPage(channel);
        }
      }
  });

}

function initFilmPage(channel) {
  console.log('Should be showing film page');
  io.sockets.in(channel).emit('update_chat', 'SERVER', 'Showing films from genres: ' + query_genres[channel]);
  io.sockets.in(channel).emit('show_film_page', films[channel][0]);
}

});
