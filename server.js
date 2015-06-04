var port = 8080;
var express = require('express');
var app     = express();
var http    = require('http');
var server  = app.listen(port);
//var server  = http.createServer(app);
var io      = require('socket.io').listen(server);
var request = require('request');

// To send verification emails to users
var nodemailer = require("nodemailer");
// Encryption for passwords
var bcrypt = require('bcrypt-nodejs');
// To connect to the database
var pg = require("pg");
// Internal memory cache
var NodeCache = require("node-cache");
var filmInfoCache = new NodeCache({stdTTL: 86400, useClones: true});

// Security information that needs to be moved to a skeleton file.
var post_database = "pg://g1427106_u:mSsFHJc6zU@db.doc.ic.ac.uk:5432/g1427106_u";
var api_param = 'api_key=a91369e1857e8c0cf2bd02b5daa38260';
var smtpTransport = nodemailer.createTransport("SMTP",{
  service: "Gmail",
  auth: {
    user: "email.film.test@gmail.com",
    pass: "email.test"
  }
});

server.listen(port);

// Stores the users currently in a room.
var users = {};
// Stores the films currently stored for a specific room
var films = [];
// Stores the number of users currently in a room 
var num_users = [];
// Stores the genres to be added to a query for a specific room
var query_genres = [];
// Stores how many users have sent off there prefered genres
var query_collection_count = {};
/* Stores a boolean for each channel to indicate if there is already a 
   request in progress for the next batch of films (prevents race conditions) */
var request_in_progress = {};
// Has to be greater than 0 and less than the number of films in each batch
var queryDelayBuffer = 10;
var queryBatchSize = 20; 
var guest = 0;
// If a room is already in session (choosing films) a new user cannot join
// so the rooms lock is set to true
var locks = {};
// Stores mappings from email unique ID to username for verification to 
// change user passwords.
var email_ids = [];

var dateToday = (new Date()).toISOString().substring(0,10);

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

app.use(express.static(__dirname + '/public'));

app.get('/', function(req, res) {
   res.sendFile(__dirname + '/index.html');
});

io.sockets.on('connection', function(socket) {
 
  // *********************** //
  // ******* GENERAL ******* //
  // *********************** //

  console.log('Obtained connection');

  // Not called ?
  socket.on('generate_films', function(room, genres) {
    console.log('DEPRECATED: socket on generate_films');
    query_genres[room] = genres;
    console.log('Generating films for room ' + room + ' of genres: ' + query_genres[room]);
    // Initialise film list with results from page 1
    // This function now calls back to show the film pages once done
    add20FilmsByGenre(1, room, query_genres[room]);
    //io.sockets.in(room).emit('initialise', films[room][0]);
  });

  socket.on('leave_room', function(username, room) {
    // Called when a user leaves a room (via button), free resources 
    // should tear down the room if username is the last user
    socket.leave(room);
    users[room][username].ready = false;
    
    console.log(username + ' is leaving room ' + room);
    free_resources(username, room);
  });

  socket.on('disconnect', function() {
    // Called when a user leaves a room (via disconnect), free resources 
    // should tear down the room if username is the last user
    console.log(socket.username + ' has disconnected from room ' + socket.channel);
    free_resources(socket.username, socket.channel);
  });

  function free_resources(username, channel) {
    
      if (typeof username !== 'undefined' && typeof channel !== 'undefined'
          && typeof users[channel] !== 'undefined') {
        delete users[channel][username];
        io.sockets.in(channel).emit('update_user_list', users[channel]);
         
        // If the user is not a quest and has requested a change in 
        // password delete the unique ID to username mapping
        if (!/^(guest)/.test(username) && email_ids[username] !== 'undefined'){
          delete email_ids[username];
        }
        --num_users[channel];
        // If all users have left, tear down the room after 30 secs
        if (num_users[channel] == 0) {
            setTimeout(function() {
            console.log('Tear down room: ' + channel);
            delete users[channel];
            delete films[channel];
            delete query_collection_count[channel];
            delete request_in_progress[channel];
            delete query_genres[channel];
            }, 30000);
        }
    }
  }

  // ************************** //
  // ******* FIRST PAGE ******* //
  // ************************** //

  socket.on('get_guest_id', function() {
    // TODO: random guest id?
    guest++;
    // Gets an unused guest id then calls set username 
    // so the client can get and set this username
   socket.emit('set_username', 'guest' + guest);
  });

  // ************************** //
  // ******* LOGIN PAGE ******* //
  // ************************** //

  socket.on('sign_in', function(username, password) {
    // Gets the row corresponding to username then calls sign in with this row
    get_user_data(username, password, 'NOTSET', 'NOTSET', sign_in);
  });

  function sign_in(username, password, email, hash, result){
    // Report error if user does not exist
    if(result.rows.length != 1) {
      socket.emit('incorrect_login',"No such user", false);
      return;
    }
    // Report error if the password is incorrect
    if(!bcrypt.compareSync(password,result.rows[0].password)) {
      socket.emit('incorrect_login', "Incorrect password",true);
      return;
    }
    // Correct password entered -> sign in
    console.log("User " + username + " chosen genres " + result.rows[0].genres);
    socket.emit('correct_login',username, result.rows[0].genres, result.rows[0].email);
  }

  // **************************** //
  // ******* SIGN UP PAGE ******* //
  // **************************** //

  socket.on('sign_up', function(username, password, email) {
    // Gets the row corresponding to username then calls sign up with this row
    get_user_data(username, password, email, 'NOTSET', sign_up);
  });


  function sign_up(username, password, email, new_password, result){
    // If a user with the same username has been found or the 
    // username includes the word guest report an error to client
    if(result.rows.length != 0 || /^(guest)/.test(username)){
      socket.emit('user_already_exists', username);
    } 
    else
    {
      // Gets salt and hashes the password to be stored in the database
      var salt = bcrypt.genSaltSync();
      var hash = bcrypt.hashSync(password, salt);
      insert_user(username, hash, email);
      socket.emit('signed_in', username, email);
    }
  }

  // ***************************** //
  // ******* SETTINGS PAGE ******* //
  // ***************************** //

  socket.on('change_settings', function(username, genres) {
    // Updates the list of genres relating to a users defualt 
    // preferences stored in the database
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

  socket.on('send_email', function(email, username) {
    // TODO: need to store random id
    var id = 32;
    // Sets the mapping from username to unique ID 
    // (deleted when user disconnects)
    email_ids[username] = id;
    // Set up email
    var mailOptions={
      to : email,
      subject : 'Password unique id',
      text : 'ID: ' + id
    }
    // Send email
    smtpTransport.sendMail(mailOptions, function(error, response){
      if(error){
        console.log(error);
      }else{
        console.log("Message sent: " + response.message);
      }
    });
  });

  socket.on('change_password', function(id, username, old_password, new_password) {
    // Checks that the user has entered the correct unique ID (sent in email)
    if (email_ids[username] == id) {
      // Encrypts new password
      var salt = bcrypt.genSaltSync();
      var hash = bcrypt.hashSync(new_password, salt);
      // Checks old password is correct then inserts new hashed password
      get_user_data(username, old_password, 'NOTSET', hash, check_old_password);
    }
    else{
      // Incorrect unique ID has been entered
      socket.emit('incorrect_input', "Incorrect unique ID");
    }
  });

  // ************************* //
  // ******* ROOM PAGE ******* //
  // ************************* //

  socket.on('new_room', function() {
    // Sets up newly created room, with no users
    // (set_room_id then goes on to add admin to room)
    // TODO: Random Room ID Generator, just using guest for now
    var channel = guest++;
    socket.channel = channel;
    users[channel] = {};
    num_users[channel] = 0;
    films[channel] = [];
    query_genres[channel] = [];
    query_collection_count[channel] = [];
    request_in_progress[channel] = false;
    // This then calls user_join on client side to add admin to room.
    socket.emit('set_room_id', channel);
  });

  socket.on('user_join', function(username, channel) {
    // Adds a user to a room
    socket.username = username;
    socket.channel = channel;
    if (locks[channel] == true) {
      // If a room is already in session (picking films)
      socket.emit('room_is_locked');
    } else if (typeof users[channel] === 'undefined') {
      // If a room has not been set up yet
      socket.emit('room_not_initialised');
    } else {
      // Adds user to channel and send them to the lobby page to wait 
      users[channel][username] = {username:username, ready:false};
      socket.join(channel);
      ++num_users[channel];
      socket.emit('joined_room', channel);
      io.sockets.in(socket.channel).emit('update_user_list', users[channel]);
     }
  });

  // ************************** //
  // ******* LOBBY PAGE ******* //
  // ************************** //
 
  socket.on('user_add_genres', function(genres) {
    // Adds the users genres preferences to the rooms 
    // list of genres to be sent to filter the API query
    query_genres[socket.channel] = query_genres[socket.channel].concat(genres);
    ++query_collection_count[socket.channel];
    if (query_collection_count[socket.channel] >= num_users[socket.channel]) {
      console.log('All users have voted. Should fire off only once.');
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

  socket.on('go_signal', function(room) {
    locks[room] = true;
    io.sockets.in(room).emit('waiting_signal');
  });
 
  socket.on('force_leave_signal', function(room) {
    console.log('Admin has left room ' + room);
    socket.broadcast.to(room).emit('force_leave');
  });

  socket.on('ready_signal', function(username, room) {
    console.log(username + ' is ready');
    users[room][username].ready = true;
    io.sockets.in(room).emit('update_user_list', users[room]);
  });

  // ************************* //
  // ******* FILM PAGE ******* //
  // ************************* //

  socket.on('choice', function(decision, index, inc) {
    // Only responds to choice if there is another film ready
    if (typeof films[socket.channel][index+1] !== 'undefined'
        && typeof films[socket.channel][index+1].shortPlot !== 'undefined'
        && typeof films[socket.channel][index+1].runtime !== 'undefined') {
      if(inc){
        // If yes increments that films yes count
        films[socket.channel][index].yes_count++;
        console.log(films[socket.channel][index].yes_count + ' vs ' + num_users[socket.channel]);
      }
      if (films[socket.channel][index].yes_count >= num_users[socket.channel]) {
        film_found(films[socket.channel][index]);
        // If every user in the channel has said yes to the film then 
        // take every user to the 'found page' with that film displayed
        io.sockets.in(socket.channel).emit('film_found', films[socket.channel][index]);
        // Room no longer in session TODO move? delete? Chase
        locks[socket.channel] = false;
      } else {
        // Go to next film
        index++;
        var message = ' said ' + decision + ' to movie: ' + films[socket.channel][index-1].title;
    	  socket.emit('update_chat', 'You', message);
        if (index == (films[socket.channel].length - queryDelayBuffer) 
            && !request_in_progress[socket.channel]) {
          // Gets next request if a request is not in progress
          request_in_progress[socket.channel] = true; // TODO: Henry you never set this to false?
          var nextPage = Math.floor(index / queryBatchSize) + 2;
          add20FilmsByGenre(nextPage, socket.channel, query_genres[socket.channel]);
        }
        // Send news films to the user with the updated index
        socket.emit('new_films', films[socket.channel][index], index);
      }
    } 
  });

  function film_found(film){
    // Updates popular films database with new film found
    get_film(film);
    // Checks the size of the list - if it is beyond a limit remove all old entries (by last updated)
  }

  function get_film(film){
    // Given a film ID 
    //    if an entry exists in popular films -> update
    //    if no entry exists -> insert
    pg.connect(post_database, function(err, client, done) {
      if(err) {
        return console.error('error connecting', err);
      }
    console.log('film.id: ' + film.id);

      client.query('SELECT * FROM popular_films WHERE film_id = $1;', [film.id], function(err, result) {
        if(err) {
          return console.error('error running query', err);
        }
        if (result.rows.length == 0) {
          insert_film(film);
        }
        else {
          console.log("Updating film");
          update_film(film, result.rows[0].count + 1);
        }
        client.end();
      });
    });
  }

  function insert_film(film){
    pg.connect(post_database, function(err, client, done) {
      if(err) {
        return console.error('error connecting', err);
      }
      client.query('INSERT INTO popular_films (film_id, poster_url, count, last_time_updated) VALUES($1, $2, 0, $3);',
                   [film.id, film.poster_path, new Date()], function(err, result) {
        if(err) {
          return console.error('error running query', err);
        }
        client.end();
      });
    });
  }

  function update_film(film, new_count){
    pg.connect(post_database, function(err, client, done) {
      if(err) {
        return console.error('error connecting', err);
      }
      client.query('UPDATE popular_films SET count=$2 WHERE film_id=$1;', [film.id, new_count], function(err, result) {
        if(err) {
          return console.error('error running query', err);
        }
        client.end();
      });
    });
  }
 
  // ************************** //
  // ******* FOUND PAGE ******* //
  // ************************** //


// ************************** //
// **** USER - FUNCTIONS **** //
// ************************** //

/**** Deleting a user: DELETE FROM users WHERE username = 'user9';****/


  function check_old_password(username, password, email, hash, result){
    // If the user does not exist report error
    if(result.rows.length != 1) {
      socket.emit('incorrect_input',"No such user");
      return;
    }
    // If the password does not match the one in the database report error
    if(!bcrypt.compareSync(password,result.rows[0].password)) {
      socket.emit('incorrect_input', "Incorrect password");
      return;
    }
    // Old password is correct so change password
    update_password(username, hash);
  }

  function update_password (username, hash) {
    // Change user password in database
    pg.connect(post_database, function(err, client, done) {
      if(err) {
        return console.error('error connecting', err);
      }
      client.query('UPDATE users SET password=$2 WHERE username=$1;', [username,hash], function(err, result) {
        if(err) {
          return console.error('error running query', err);
        }
        console.log("Changed password of user: " + username);
        socket.emit('changed_password');
        client.end();
      });
    });
  }

  function insert_user (username, password, email) {
    // Inserts a new column into the database for the new user
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

  function get_user_data(username, password, email, hash, func){
    // Gets the data about the user matching username and 
    // then calls func with this data (result)
    pg.connect(post_database, function(err, client, done) {
      if(err) {
        return console.error('error connecting', err);
      }

      client.query('SELECT * FROM users WHERE username = $1', [username], function(err, result) {
        if(err) {
          return console.error('error running query', err);
        }
        func(username, password, email, hash, result);
        client.end();
      });
    });
  }

// ************************** //
// **** MOVIE API QUERIES *** //
// ************************** //

// TODO: Henry can you put some of this in another file? 
// Also indentation is wrong. Like passing in callback functions.

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
