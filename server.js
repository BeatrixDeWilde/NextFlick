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
// Asynchronous module for async requests with a max concurrency limit
var async = require("async");

var pythonShell = require('python-shell');

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
// Array of global films to store information about each just once
var globalFilms = [];
// Stores the number of users currently in a room 
var num_users = [];
// Stores the runtime filter:  0 = any, 2 = < 2hrs, 3 = < 3hrs
var runtime_filters = [];
// Stores the genres to be added to a query for a specific room
var query_genres = [];
// Stores how many users have sent off there prefered genres
var query_collection_count = {};
/* Stores a boolean for each room to indicate if there is already a 
   request in progress for the next batch of films (prevents race conditions) */
var request_in_progress = {};
/* Stores a boolean to indicate if there is a request to add more films
   to the global film list in progress */
var global_request_in_progress = false;
// Boolean to tell whether global film list has reached max size
var isGlobalFilmListMaxed = false;
// Has to be greater than 0 and less than the number of films in each batch
var queryDelayBuffer = 12;
var queryBatchSize = 25;
// Keeps track of the last page of films to be queried
var lastPageQueried = 0;

/* Stores the last film index (per room) that has been filtered 
   for film querying of genres, runtime etc. */
var nextFilmIndexFilter = [];

var guest = 0;
var channel_ids = [];
// If a room is already in session (choosing films) a new user cannot join
// so the rooms lock is set to true
var locks = {};
// Stores mappings from email unique ID to username for verification to 
// change user passwords.
var email_ids = [];
var guest_ids = [];
var room_ids = [];

var frequencyToFilterOutGenres = 100;
var ratioToFilterOutGenres = 0.1;
var minNumberOfGenres = 3;

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

var insert_limit = 1;
var insertQueue = async.queue(queue_insert_func, insert_limit);

insertQueue.drain = function() {
  console.log('All database update/insert requests completed');
}

// OMDb requests limited to 20 concurrent requests by async queue
var maxConcurrency = 20;
var extraInfoReqQueue = async.queue(addExtraFilmInfo, maxConcurrency);

extraInfoReqQueue.drain = function() {
  console.log('All OMDb requests have been processed for current batch');
}

// CanIStreamItRequests are also limited to 20 concurrent requests by async queue
var canIStreamItQueue = async.queue(getStreamingServices, maxConcurrency);

canIStreamItQueue.drain = function() {
  console.log('All CanIStreamIt API requests have been processed for current batch');
}

/* Gets date for 3 months ago so only suggests films that have been released 
   on DVD or are avaiblable to stream */
var date = new Date();
date.setMonth(date.getMonth() - 3);
var queryDate = date.toISOString().substring(0,10);

console.log('Server started.');

// Populate film list with films on server start
addFilms(100);


io.sockets.on('connection', function(socket) {
 
  // *********************** //
  // ******* GENERAL ******* //
  // *********************** //

  console.log('Obtained connection');

  socket.on('leave_room', function(username, room) {
    // Called when a user leaves a room (via button), free resources 
    // should tear down the room if username is the last user
    socket.leave(room);
    if (username != undefined 
        && room != undefined 
        && users[room] != undefined 
        && users[room][username] != undefined) {
      users[room][username].ready = false;
    }
    
    console.log(username + ' is leaving room ' + room);
    free_resources(username, room);
  });

  socket.on('disconnect', function() {
    // Called when a user leaves a room (via disconnect), free resources 
    // should tear down the room if username is the last user
    console.log(socket.username + ' has disconnected from room ' + socket.room);
    users_force_leave_if_admin(socket.username, socket.room);
    free_resources(socket.username, socket.room);
  });

  function free_resources(username, room) {
    if (typeof username !== 'undefined' && typeof room !== 'undefined'
        && typeof users[room] !== 'undefined') {
      if (typeof users[room][username] !== 'undefined') {
        update_user_popular_films(users[room][username].chosen_films, username);
      }
      delete users[room][username];
      io.sockets.in(room).emit('update_user_list', users[room]);
       
      // If the user is not a quest and has requested a change in 
      // password delete the unique ID to username mapping
      if (!/^(guest)/.test(username) && email_ids[username] !== 'undefined'){
        delete email_ids[username];
      }
      --num_users[room];
      // If all users have left, tear down the room after 30 secs
      if (num_users[room] == 0) {
        locks[room] = true;
        // Tear down room.
        setTimeout(function() {
        console.log('Tear down room: ' + room);
        remove_room_id(room);
        delete users[room];
        delete films[room];
        delete runtime_filters[room];
        delete query_collection_count[room];
        delete nextFilmIndexFilter[room];
        delete request_in_progress[room];
        delete query_genres[room];
        channel_ids[room] = false;
        delete locks[room];
        }, 30000);
      }
    }
  }

  function update_user_popular_films(chosen_films, user){
    if (!/^(guest)/.test(user)) {
      for(var index in chosen_films) {
        insertQueue.push({film:chosen_films[index],username:user}, function(err) {
        });
      }
    }
  }

  function users_force_leave_if_admin(username, room) { 
    if (room != undefined && username != undefined
        && users[room] != undefined && users[room][username] != undefined) {
      if (users[room][username].is_admin) {
        console.log('Admin (' +username +')  has left room ' + room);
        socket.broadcast.to(room).emit('force_leave');
      }
    }
  }

  function generate_id() { 
    return Math.random().toString(10).substring(2,5);
  }
  
  function generate_guest_id() {
    return generate_id_for_list(guest_ids);
  }

  function generate_room_id() {
    return generate_id_for_list(room_ids);
  }
   
  function generate_id_for_list(list) {
    var id = generate_id();
    while (list[id] == true) {
      id = generate_id();
    }
    list[id] = true;
    return id;
  }
 
  function remove_guest_id(username) {
    if (username.substring(0,5) == 'guest') {
      var guest_id = username.substring(5);
      console.log('Freeing guest_id: ' + guest_id);
      guest_ids[guest_id] = false;
    }
  }

 function remove_room_id(room) {
   room_ids[room] = false;
 } 
 

  // ************************** //
  // ******* FIRST PAGE ******* //
  // ************************** //

  socket.on('get_guest_id', function() {
    // TODO: random guest id?
    var guest_id = guest++;
    //var guest_id = generate_guest_id();
    // Gets an unused guest id then calls set username 
    // so the client can get and set this username
   socket.emit('set_username', 'guest' + guest_id);
  });

  // ************************** //
  // ******* LOGIN PAGE ******* //
  // ************************** //

  socket.on('forgotten_password', function(username){
    get_user_data(username, 'NOTSET', 'NOTSET', 'NOTSET', forgot_pass);
  });

  function forgot_pass(username, password, email, new_password, result){
    // Report error if user does not exist
    if(result.rows.length != 1) {
      socket.emit('incorrect_login', "<b>No such user</b>", false);
      return;
    }
    socket.emit('forgotten_password_user_exists', result.rows[0].email, username, result.rows[0].genres);
  }

  socket.on('sign_in', function(username, password) {
    // Gets the row corresponding to username then calls sign in with this row
    get_user_data(username, password, 'NOTSET', 'NOTSET', sign_in);
  });

  function sign_in(username, password, email, hash, result){
    // Report error if user does not exist
    if(result.rows.length != 1) {
      socket.emit('incorrect_login',"<b>No such user</b>", false);
      return;
    }
    // Report error if the password is incorrect
    if(!bcrypt.compareSync(password,result.rows[0].password)) {
      socket.emit('incorrect_login', "<b>Incorrect password</b>",true);
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
    if(result.rows.length != 0){
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
        done();
        if(err) {
          return console.error('error running query change settings', err);
        }
      });
    });
  });

  socket.on('send_email', function(email, username) {
    // Sets the mapping from username to unique ID 
    // (deleted when user disconnects)
    email_ids[username] = generate_id();
    // Set up email
    var mailOptions={
      to : email,
      subject : 'NextFlick: Unique ID',
      text : 'Hey from NextFlick. User ' + username + " has requested a new password please enter the unique ID " + email_ids[username] + " into the page shown. This ID will become invalid as soon as you leave this page."
    }
    // Send email
    smtpTransport.sendMail(mailOptions, function(error, response){
      if (error) {
        console.log(error);
      } else {
        console.log("Message sent: " + response.message);
      }
    });
  });

  socket.on('change_password', function(id, username, old_password, new_password, forgotten_password) {
      // Checks that the user has entered the correct unique ID (sent in email)
      if (email_ids[username] == id) {
        // Encrypts new password
        var salt = bcrypt.genSaltSync();
        var hash = bcrypt.hashSync(new_password, salt);
        if (!forgotten_password) {

          // Checks old password is correct then inserts new hashed password
          get_user_data(username, old_password, 'NOTSET', hash, check_old_password);
        } else {
          update_password(username, hash);
        }
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
    var room = generate_room_id();
    socket.room = room;
    users[room] = {};
    num_users[room] = 0;
    films[room] = [];
    nextFilmIndexFilter[room] = 0;
    runtime_filters[room] = 0;
    query_genres[room] = [];
    query_collection_count[room] = [];
    request_in_progress[room] = false;
    // This then calls user_join on client side to add admin to room.
    socket.emit('set_room_id', room);
  });

  socket.on('user_join', function(username, room, is_admin_bool) {
    // Adds a user to a room
    socket.username = username;
    socket.room = room;
    if (locks[room] == true) {
      // If a room is already in session (picking films)
      socket.emit('room_is_locked');
    } else if (typeof users[room] === 'undefined') {
      // If a room has not been set up yet
      socket.emit('room_not_initialised');
    } else {
      // Adds user to room and send them to the lobby page to wait 
      /* genreLearning is to filter out films which of genres which are repeatedly
         being said 'no' to by each user - store all genres and record number of
         yesses for that genre (first element in array) and total number of times
         the user is shown that genre (second element in the array). */
      users[room][username] = {username: username, ready: false, is_admin: is_admin_bool, chosen_films: {},
                              genreLearning: {"28":    [1,1],
                                              "12":    [1,1],
                                              "16":    [1,1],
                                              "35":    [1,1],
                                              "80":    [1,1],
                                              "99":    [1,1],
                                              "18":    [1,1],
                                              "10751": [1,1],
                                              "14":    [1,1],
                                              "10769": [1,1],
                                              "36":    [1,1],
                                              "27":    [1,1],
                                              "10402": [1,1],
                                              "9648":  [1,1],
                                              "10749": [1,1],
                                              "878":   [1,1],
                                              "10770": [1,1],
                                              "53":    [1,1],
                                              "10752": [1,1],
                                              "37":    [1,1]
                                             }
                              };
      socket.join(room);
      ++num_users[room];
      socket.emit('joined_room', room);
      io.sockets.in(socket.room).emit('update_user_list', users[room]);
     }
  });
  
  socket.on('user_set_admin', function(username, room) {
     users[room][username].is_admin = true;
  });

  socket.on('get_popular_films', function(username){
    if (/^(guest)/.test(username)) {
      guest_popular_films();
    } 
    else {
      user_popular_films(username);
    }
  });


  function guest_popular_films(){
    // Gets the 'limit' most popular films
    var limit = 20;
    pg.connect(post_database, function(err, client, done) {
      if(err) {return console.error('error connecting', err);}
      client.query('SELECT poster_url FROM popular_films ORDER BY count DESC LIMIT $1;', [limit], function(err, result) {
        done();
        if(err) {
          return console.error('error running query get popular films', err);
        }
        socket.emit('popular_films', result.rows, true);
      });
    });
  }
  
  function user_popular_films(username){
    // Gets films relating to user
    var client = new pg.Client(post_database);
    client.connect(function(err){
      if(err) {return console.error('could not connect to postgres user_popular_films', err);}
      client.query("SELECT distinct U.username, count(*) as num from user_popular_films U inner join user_popular_films " 
                    + " P ON U.film_id = P.film_id and U.username <> P.username WHERE U.username <> '" 
                    + username + "' GROUP BY U.username ORDER BY num;", function(err, result) {
        if(err) {return console.error('error running query user_popular_films', err);}
        loop_until_ten_popular_films(result.rows, [], username);
        client.end();
      });
    });
  }

  function loop_until_ten_popular_films(users, films, original_user) {
    var limit = 20;
    var scroller_image_min = 3;
    if (users.length == 0) {
      // Base case
      if (films.length > scroller_image_min) {
        socket.emit('popular_films', films, false);
      } else {
        guest_popular_films();
      }
      return;
    }
    // Recursive case
    var user = users.pop();
    var client = new pg.Client(post_database);
    client.connect(function(err){
      if(err) {return console.error('could not connect to postgres loop_until_ten_popular_films', err);}
      client.query("SELECT U.poster_url from user_popular_films U where U.username = '" 
                    + user.username + "' except select P.poster_url from user_popular_films P where P.username = '" 
                    + original_user + "';", function(err, result) {
        if(err) {return console.error('error running query loop_until_ten_popular_films', err);}
        films = add_user_films_list(films, result.rows, limit);
        if (films.length >= limit) {
          socket.emit('popular_films', films, false);
        }
        else {
          loop_until_ten_popular_films(users, films, original_user);
        }
        client.end();
      });
    });
  }

  function add_user_films_list(films, result, limit) {
    for (var i = 0; i < result.length; i++) {
      if (films.indexOf(result[i].poster_url) < 0 ) {
        films.push(result[i].poster_url);
      }
      if (films.length >= limit) {
        break;
      }
    }
    return films;
  }

  socket.on('reset_user', function(username) {
    console.log('reset user: '+ username );
    remove_guest_id(username);
  });

  // ************************** //
  // ******* LOBBY PAGE ******* //
  // ************************** //
 
  socket.on('user_add_genres', function(genres) {
    // Adds the users genres preferences to the rooms 
    // list of genres to be sent to filter the API query
    // Convert each genre string to its ID
    for (var i = 0, len = genres.length; i < len; i++) {
      genres[i] = genreIdLookup[genres[i]];
    }
    console.log('Genres to filter by: ' + genres);
    query_genres[socket.room] = query_genres[socket.room].concat(genres);
    ++query_collection_count[socket.room];
    if (query_collection_count[socket.room] >= num_users[socket.room]) {
      console.log('All users have voted. Should fire off only once.');
      // Remove duplicate genres from genre array for room
      var uniqueGenres = query_genres[socket.room].filter(function(item, pos) {
        return query_genres[socket.room].indexOf(item) == pos;
      });
      query_genres[socket.room] = uniqueGenres;
      generate_films(socket.room);
    }
  });
  
  /* runtime filter is an integer specifying the number of hours 
     the film runtime must be less than */
  socket.on('add_runtime_filter', function(runtimeFilter) {
    runtime_filters[socket.room] = parseInt(runtimeFilter);
  });

  function generate_films(room) {
    // Initialise film list with results from page 1
    // This function now calls back to show the film pages once done
    console.log('About to filter films for room ' + room + ' with genres ' + query_genres[room]);
    if (!request_in_progress[room]) {
      request_in_progress[socket.room] = true;
      filterFilmsForRoom(room, query_genres[room], runtime_filters[room], queryBatchSize);

    }
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
    // If inc then increments that film's yes count attribute
    if (films[socket.room] == undefined || films[socket.room][index] == undefined) {
      // Does nothing as page from an old/invalid session
      return;
    }
    if(inc) {
      films[socket.room][index].yes_count++;
      var global_film_index = films[socket.room][index].filmIndex;
      if (!/^(guest)/.test(socket.username)) {
        users[socket.room][socket.username].chosen_films[global_film_index] = globalFilms[global_film_index];
      }
      console.log(films[socket.room][index].yes_count + ' vs ' + num_users[socket.room]);
    }

    // Update genre yes count of film
    var filmGenres = globalFilms[films[socket.room][index].filmIndex].genre_ids;
    var numFilmGenres = filmGenres.length;
    if (numFilmGenres != 0) {
      for (var i = 0; i < numFilmGenres; i++) {
        var currGenre = filmGenres[i].toString();
        if (users[socket.room][socket.username] != undefined
            && users[socket.room][socket.username].genreLearning != undefined
            && users[socket.room][socket.username].genreLearning[currGenre] != undefined) {
          if (inc) {
            users[socket.room][socket.username].genreLearning[currGenre][0]++;
          }
          users[socket.room][socket.username].genreLearning[currGenre][1]++;
        }
      }
    }

    // THE GENRE PURGE (happens every 100 films)
    if (index % frequencyToFilterOutGenres == 0 && index != 0 && query_genres[socket.room].length > minNumberOfGenres) {
      //for (var i = 0; i < ) {
        var numUsers = Object.keys(users[socket.room]).length;
        var lowestRatios = [];
        var lowestRatioAverage = null;
        var genreToRemove = null;
        var filterGenres = query_genres[socket.room];
        for (var genre in filterGenres) {
          for (var username in users[socket.room]) {
            
            if (users[socket.room][socket.username] != undefined
                && users[socket.room][socket.username].genreLearning != undefined
                && users[socket.room][socket.username].genreLearning[filterGenres[genre]] != undefined
                && users[socket.room][socket.username].genreLearning[filterGenres[genre]][0] != undefined) {
              var yesCount = users[socket.room][username].genreLearning[filterGenres[genre]][0];
              var totalCount = users[socket.room][username].genreLearning[filterGenres[genre]][1];
              var ratio = yesCount / totalCount;
              if (ratio < ratioToFilterOutGenres) {
                lowestRatios.push(ratio);
              } else {
                lowestRatios = [];
                break;
              }
              // If on last user whos ratio is less than threshold
              var ratioCount = lowestRatios.length;
              if (ratioCount == numUsers) {
                var ratioSum = 0;
                for (var i = 0; i < ratioCount; i++) {
                  ratioSum += lowestRatios[i];
                }
                var newLowestRatioAverage = ratioSum / ratioCount;
                if (lowestRatioAverage == null 
                    || (lowestRatioAverage != null 
                        && newLowestRatioAverage < lowestRatioAverage)) {
                  lowestRatioAverage = newLowestRatioAverage;
                  genreToRemove = filterGenres[genre];
                  console.log('Lowest ratio average: ' + lowestRatioAverage);
                  console.log('Ratios: ' + lowestRatios);
                  console.log('For genre ' + filterGenres[genre] + ' which has ' + yesCount + ' yesses, and has been seen ' + totalCount + ' times' );
                  lowestRatios = [];
                }
              }
            }
          }
        }
        if (genreToRemove != null) {
          console.log('genre to stop including in filter is ' + genreToRemove);
          genreToRemove = parseInt(genreToRemove, 10);
          var indexOfGenre = query_genres[socket.room].indexOf(genreToRemove);
          if (indexOfGenre > -1) {
            query_genres[socket.room].splice(indexOfGenre, 1);
          }
        }
        
    }

    if (films[socket.room][index].yes_count >= num_users[socket.room]) {
      film_found(globalFilms[films[socket.room][index].filmIndex]);
      // If every user in the room has said yes to the film then 
      // take every user to the 'found page' with that film displayed
      io.sockets.in(socket.room).emit('film_found', globalFilms[films[socket.room][index].filmIndex]);
      // Room no longer in session TODO move? delete? Chase
      locks[socket.room] = false;
    } else {

      if (typeof films[socket.room][index+1] !== 'undefined'
          && typeof films[socket.room][index+1].filmIndex !== 'undefined') {

        if (typeof globalFilms[films[socket.room][index+1].filmIndex] !== 'undefined'
            && typeof globalFilms[films[socket.room][index+1].filmIndex].runtime !== 'undefined') {
          // Go to next film
          index++;
          
          // Add 5 batches of films to global list 
          if (index == (globalFilms.length - queryBatchSize)) {
            addFilms(5);
          }

          if (index == (films[socket.room].length - queryDelayBuffer)
              && !request_in_progress[socket.room]) {
            // Gets next request if a request is not in progress
            request_in_progress[socket.room] = true;
            filterFilmsForRoom(socket.room, query_genres[socket.room], runtime_filters[socket.room], queryBatchSize);
            //var nextPage = Math.floor(index / queryBatchSize) + 2;
          }
          // Send news films to the user with the updated index
          socket.emit('new_films', globalFilms[films[socket.room][index].filmIndex], index);
        
        } else {
          addFilms(10);
        }

      } else {
        if (!request_in_progress[socket.room]) {
          request_in_progress[socket.room] = true;
          filterFilmsForRoom(socket.room, query_genres[socket.room], runtime_filters[socket.room], queryBatchSize);
        }
      }
    }
  });

  function film_found(film){
    // Updates popular films database with new film found
    add_popular_film(film);
    // If too many films stored deleted the last updated films
    delete_films();
  }

  function insert_film(film){
    // Puts the film in the popular films database -> intial count of 1 
    pg.connect(post_database, function(err, client, done) {
      if(err) {return console.error('error connecting', err);}
      client.query('INSERT INTO popular_films (film_id, poster_url, count, last_time_updated) VALUES($1, $2, 1, $3);',
                   [film.id, film.poster_path, new Date()], function(err, result) {
        done();
        if(err) {return console.error('error running query insert film', err);}
      });
    });
  }

  function add_popular_film(film){
    // Given a film ID 
    //    if an entry exists in popular films -> update
    //    if no entry exists                  -> insert
    pg.connect(post_database, function(err, client, done) {
      if(err) {
        return console.error('error connecting', err);
      }
      client.query('SELECT count FROM popular_films WHERE film_id = $1 ;', [film.id], function(err, result) {
        done();
        if(err) {
          return console.error('error running query add popular film', err);
        }
        if (result.rows.length == 0) {
          insert_film(film);
        }
        else {
          update_film(film, result.rows[0].count + 1);
        }
      });
    });
  }

  function update_film(film, new_count){
    // Updates the row to have the new incremented counts
    pg.connect(post_database, function(err, client, done) {
      if(err) {
        return console.error('error connecting', err);
      }
      client.query('UPDATE popular_films SET count=$2, last_time_updated=$3 WHERE film_id=$1;', [film.id, new_count, new Date()], function(err, result) {
        done();
        if(err) {
          return console.error('error running query update film', err);
        }
      });
    });
  }

  function delete_films(){
    // Number of films to be deleted from popular films
    var delete_size = 20; 
    // Max number of popular films
    var size_limit = 70;
    pg.connect(post_database, function(err, client, done) {
      if(err) {return console.error('error connecting', err);}
      client.query('DELETE FROM popular_films WHERE film_id in (SELECT film_id FROM popular_films order by last_time_updated limit $1) and $2 < (select count(*) from popular_films);',
                   [delete_size, size_limit], function(err, result) {
        done();
        if(err) {return console.error('error running query delete films', err);}
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
        done();
        if(err) {
          return console.error('error running query update password', err);
        }
        console.log("Changed password of user: " + username);
        socket.emit('changed_password', username);
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
        done();
        if(err) {
          return console.error('error running query insert user', err);
        }
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
        done();
        if(err) {
          return console.error('error running query get user data', err);
        }
        func(username, password, email, hash, result);
      });
    });
  }

});

// *********************************** //
// **** INSERT USER POPULAR FILMS  *** //
// *********************************** //

function queue_insert_func(args, callback){
  user_add_popular_film(args.film, args.username);
  delete_user_popular_films(args.username);
  callback();
}

function user_insert_film(film, username){
  //console.log("Start of insert film " + username + " film.id " + film.id);
  var client = new pg.Client(post_database);
  client.connect(function(err){
    if(err) {return console.error('could not connect to postgres user insert film', err);}
    client.query("INSERT INTO user_popular_films (film_id, poster_url, count, last_time_updated, username) VALUES($1, $2, 1, $3,'" + username + "');",
                 [film.id, film.poster_path, new Date()], function(err, result) {
      if(err) {return console.error('error running query user insert film', err);}
      client.end();
    });
  });
}

function user_add_popular_film(film, username){
  var client = new pg.Client(post_database);
  client.connect(function(err){
    if(err) {return console.error('could not connect to postgres user add popular film', err);}
    client.query("SELECT count FROM user_popular_films WHERE film_id = $1 and username ='" + username + "' ;",
     [film.id], function(err, result) {
      if(err) {return console.error('error running query user add popular film', err);}
      if (result.rows.length == 0) {
        //console.log("INSERTING user popular film " + film.id);
        user_insert_film(film, username);
      }
      else {
        //console.log("UPDATING user popular film " + film.id);
        user_update_film(film, result.rows[0].count + 1, username);
      }
      client.end();
    });
  });
}

function user_update_film(film, new_count, username){
  var client = new pg.Client(post_database);
  client.connect(function(err){
    if(err) {return console.error('could not connect to postgres user update film', err);}
    client.query("UPDATE user_popular_films SET count=$2, last_time_updated=$3 WHERE film_id=$1 and username= '" + username + "' ;",
     [film.id, new_count, new Date()], function(err, result) {
      if(err) {return console.error('error running query user update film', err);}
      client.end();
    });
  });
}

function delete_user_popular_films(username){
  // Number of films to be deleted from popular films
  var delete_size = 5; 
  // Max number of popular films
  var size_limit = 20;
  pg.connect(post_database, function(err, client, done) {
    if(err) {return console.error('error connecting', err);}
    client.query("DELETE FROM user_popular_films WHERE film_id in (SELECT film_id FROM user_popular_films where username='" + username + "' order by last_time_updated limit $1) and $2 < (select count(*) from popular_films where username='" + username + "') and username='" + username + "';",
                 [delete_size, size_limit], function(err, result) {
      done();
      if(err) {return console.error('error running query delete films', err);}
    });
  });
}

// ************************** //
// **** MOVIE API QUERIES *** //
// ************************** //

// Thriller genre: 'http://api.themoviedb.org/3/genre/53/movies'
// Base image url: 'http://image.tmdb.org/t/p/w500'
// Image sizes: w185, w342, w500, w780 (smallest to largest)
/* Get 20 films of all genres from the array parameter 'genres' 
   from page number pageNum and append them to the list of films */

function initFilmPage(room) {
  console.log('Should be showing film page');
  io.sockets.in(room).emit('update_chat', 'SERVER', 'Showing films from genres: ' + query_genres[room]);
  if (typeof films[room][0] !== 'undefined') {
    io.sockets.in(room).emit('show_film_page', globalFilms[films[room][0].filmIndex]);
  } else {
    console.log('No films in room film list! - make query more general');
  }
}


// NEW FUNCTIONS TO ONLY STORE ONE GLOBAL FILM LIST
/* Get 20 films of all genres from the array parameter 'genres' 
   from page number pageNum and append them to the list of films */

// Doesn't query with any genres, just gets popular films
// reqCounter counts and limits the number of recursive API requests
// Call function initially with reqCounter == 0
function addFilmsByGenre(pageNum, reqCounter, numBatches) {
  // Maximum page is 1000 so check last page queried was lower than this
  if (reqCounter == 0) {
    var totalToAdd = numBatches * 20;
    console.log('Adding ' + totalToAdd + ' films to global film list');
  }
  if (reqCounter < numBatches && pageNum < 1000) {
    pageNum++;
    reqCounter++;
    lastPageQueried = pageNum;
    // Only query within range 0 < n <= 1000, otherwise default query page 1
    if (pageNum == 0 || pageNum > 1000) {
      pageNum = 1;
    }

    request({
      method: 'GET',
      url: 'http://api.themoviedb.org/3/discover/movie?' + api_param + 
           '&page=' + pageNum + 
           '&include_adult=false' + 
           '&sort_by=popularity.desc' + 
           '&release_date.lte=' + queryDate,
      headers: {
        'Accept': 'application/json'
      }}, 
      function (error, response, body) {
        if (!error && response.statusCode == 200) {
          // Check JSON returned from server is valid
          var res = null;
          try {
            res = JSON.parse(body);
          } catch(e) {
            console.log('JSON parse failed for TMDb query');
          }
          if (res != null) {
            var film_list = res.results;
          
            // append films to JSON films array
            var oldLength = globalFilms.length;
            if (oldLength == 0) {
              globalFilms = film_list;
            } else {
              globalFilms.push.apply(globalFilms, film_list);
            }
         
            for (var i = oldLength, len = oldLength + film_list.length; i < len; i++) {
              // Update films information by modifying required properties
              // and deleting unnecessary ones
              extraInfoReqQueue.push(i);
              
              globalFilms[i].onNetflix = false;
              globalFilms[i].linkNetflix = null;
              globalFilms[i].onAIV = false;
              globalFilms[i].linkAIV = null;
              
              canIStreamItQueue.push(i);

              globalFilms[i].poster_path = 'http://image.tmdb.org/t/p/w342' + globalFilms[i].poster_path;
              delete globalFilms[i].overview;
              delete globalFilms[i].backdrop_path;
              delete globalFilms[i].video;
              delete globalFilms[i].vote_average;
              delete globalFilms[i].vote_count;
              
            }
          } else {
            console.log('Server returned invalid JSON for TMDb query');
          }
          
          if (reqCounter < numBatches) {
            addFilmsByGenre(pageNum, reqCounter, numBatches);
          } else {
            global_request_in_progress = false;
            //console.log('Recursive TMDb API query limit reached for current batch');
          }

      } else {
        console.log('TMDb API request failed for page ' + pageNum);
      }
    
    }); 
  } else {
    console.log('request counter greater than number of batches requested or requested page greater than 1000');
    isGlobalFilmListMaxed = true;
  }
}

// Query OMDb API for extra film information (plot, runtime, rating etc.)
function addExtraFilmInfo(film_index, callback) {
  var encTitle = encodeURIComponent(globalFilms[film_index].title);
  var releaseDate = globalFilms[film_index].release_date;
  if (releaseDate != null && releaseDate.length > 4) {
    var releaseYear = releaseDate.substr(0,4);
  } else {
    var releaseYear = '';
  }
  request({
    method: 'GET',
    url: 'http://www.omdbapi.com/?' +
         't=' + encTitle +
         '&y=' + releaseYear +
         '&plot=short' +
         '&r=json' +
         '&tomatoes=true', 
    headers: {
      'Accept': 'application/json'
    }}, 
    function (error, response, body) {
      if (!error && response.statusCode == 200) {
        var jsonParseFailed = false;
        // Ensure JSON returned from server is valid
        try {
          var infoResponse = JSON.parse(body);
        } catch(e) {
          jsonParseFailed = true;
        }
        // Create cache JSON object to store
        var filmId = globalFilms[film_index].id;
        var filmInfo = {};
        if (!jsonParseFailed && infoResponse.Response === 'True') {
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

        // Update films with extra film information
        globalFilms[film_index].shortPlot = filmInfo.info["Plot"];
        globalFilms[film_index].rated = filmInfo.info["Rated"];
        globalFilms[film_index].imdbRating = filmInfo.info["imdbRating"];
        globalFilms[film_index].metascore = filmInfo.info["Metascore"];
        globalFilms[film_index].tomatoRating = filmInfo.info["tomatoMeter"];
        globalFilms[film_index].runtime = filmInfo.info["Runtime"];
      } else {
        console.log('OMDb API request failed for film index ' + film_index);
      }
      /* Callback needed for async queue to limit maximum number of concurrent
         requests to 20 */
      callback();
  });

}

function filterFilmsForRoom(room, genres, runtime, numFilms) {
  //TODO: add loading overlay when films are being filtered and next isn't yet ready
  var listLength = films[room].length;
  var numQueryGenres = genres.length;
  var filmsAdded = 0;
  var filterIndex = nextFilmIndexFilter[room];

  while (filmsAdded < queryBatchSize) {
    if (globalFilms[filterIndex] != null
        && globalFilms[filterIndex].genre_ids != null
        && globalFilms[filterIndex].runtime != null) {

      var currFilmIds = globalFilms[filterIndex].genre_ids;
      var currFilmRuntime = globalFilms[filterIndex].runtime;
      // Filter films by genre and runtime
      if (numQueryGenres == 0 && filterFilmByRuntime(currFilmRuntime, runtime)) {
        filmsAdded++;
        addFilmToRoomList(filterIndex, room);

      } else if (filterFilmByGenre(currFilmIds, genres)
                 && filterFilmByRuntime(currFilmRuntime, runtime)) {
        filmsAdded++;
        addFilmToRoomList(filterIndex, room);
      }
      filterIndex++;

    } else {
      console.log('Filtering ran out of loaded global films so added more to global list');
      addFilms(10);
      break;
    }

  }
  nextFilmIndexFilter[room] = filterIndex;
  request_in_progress[room] = false;

  if (listLength == 0) {
    if (films[room].length == 0) {
      // If no films, filter films recursively until room film list is not empty, then initialise
      setTimeout(filterFilmsForRoom, 5000, room, genres, runtime, numFilms - filmsAdded);
    } else {
      initFilmPage(room);
    }
  } else {
    request_in_progress[room] = false;

  }

}

// Returns true if film matches genre filter, false otherwise
function filterFilmByGenre(filmGenreIds, queryGenreIds) {
  
  var numFilmGenres = filmGenreIds.length;
  var numQueryGenres = queryGenreIds.length;

  if (numFilmGenres != 0) {

    commonGenreLoop:
    for (var i = 0; i < numFilmGenres; i++) {
      for (var j = 0; j < numQueryGenres; j++) {
        if (filmGenreIds[i] == queryGenreIds[j]) {
          //console.log('Added film ' + globalFilms[filmIndex].title + ' to room film list');
          return true;
        }
      }
    }
  }
  return false;

}

function filterFilmByRuntime(filmRuntimeAttr, filterRuntime) {
  
  if (filterRuntime == 0) {
    return true;
  }

  if (filterRuntime != null) {
    // Get runtime filter in minutes
    filterRuntime *= 60; 
  }

  if (filmRuntimeAttr !== 'N/A') {
    var filmRuntimeStr = filmRuntimeAttr.replace('min', '');
    var filmRuntime = parseInt(filmRuntimeStr);
    return filmRuntime <= filterRuntime;
  }
  return false;

}



function addFilmToRoomList(index, room) {
  var newFilm = {
                  "filmIndex": index,
                  "yes_count": 0
                };
  films[room].push(newFilm);
}


function addFilms(numBatches) {
  if (!global_request_in_progress && numBatches >= 1 && !isGlobalFilmListMaxed) {
    global_request_in_progress = true; 
    addFilmsByGenre(lastPageQueried, 0, numBatches);
    //TODO: If a TMDb request fails make sure retried
  } else {
    if (isGlobalFilmListMaxed) {
      console.log('Global film list is MAXED!!');
    }
  }
}

function getStreamingServices(index, callback) {
  var options = {
    mode: 'json',
    args: [globalFilms[index].title],
    scriptPath: 'CanIStreamIt/canistreamit'
  };

  pythonShell.run('script.py', options, function (err, results) {
    if (err) {
      console.log('Python script error');
      console.log('Error, film title: ' + globalFilms[index].title);
    } else {
      if (results != null) {
        if (results[0] != undefined 
            && results[0]["amazon_prime_instant_video"] != undefined
            && results[0]["amazon_prime_instant_video"]["direct_url"] != undefined) { 
          //Film is available on Amazon Instant Video
          globalFilms[index].onAIV = true;
          globalFilms[index].linkAIV = results[0]["amazon_prime_instant_video"]["direct_url"];
        } else if (results[1] != undefined 
                   && results[1]["amazon_video_rental"] != undefined
                   && results[1]["amazon_video_rental"]["url"] != undefined) {
          //Film is available to rent on Amazon Instant Video
          globalFilms[index].onAIV = true;
          globalFilms[index].linkAIV = results[1]["amazon_video_rental"]["url"];
        }
        if (results[0] != undefined 
            && results[0]["netflix_instant"] != undefined) {
          //Film is available on Netflix
          globalFilms[index].onNetflix = true;
          globalFilms[index].linkNetflix = results[0]["netflix_instant"]["direct_url"];
        }
      }
    }
    callback();
  });
}
