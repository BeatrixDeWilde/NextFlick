var id = window.location.pathname.substring(6);
var index = 0;
var socket = io.connect();
var username = 'NOTSET';
var room = 'NOTSET';
var on_main_page = false;
var is_admin = false;
var user_genres = [];

var genreList = [
  "Action",
  "Adventure",
  "Animation",
  "Comedy",
  "Crime",
  "Documentary",
  "Drama",
  "Family",
  "Fantasy",
  "Foreign",
  "History",
  "Horror",
  "Music",
  "Mystery",
  "Romance",
  "Science_Fiction",
  "Thriller",
  "War",
  "Western"
]

// ******* GENERAL ******* //

socket.on('update_user_list', function(users) {
  $('#users').empty();
  $('#main_page_users').empty();
  $.each(users, function(key, value) {
    if(value == username){
      $('#users').append('<div><b>' + value+ '</b></div>');
    }else{
      $('#users').append('<div>' + value+ '</div>');
    }
    $('#main_page_users').append('<div>' + value + '</div>');
  });
});

function add_genre_checkboxes(genre_div, id_extension){
  $.each(genreList, function(index, genre){
    $(genre_div).append("<div class='checkbox'><label><input type='checkbox' id=" + genre + id_extension + ">" + genre + "</label></div>");
  });
}

socket.on('connect', function(){
  add_genre_checkboxes('.genres','');
  add_genre_checkboxes('.genre_settings','_settings');
});

socket.on('set_username', function(user) {
     username = user;
});

// ******* FIRST PAGE ******* //

$(function(){
  // Fading out pages etc
  $('#guest').click(function() {
    socket.emit('get_guest_id');
    $('.first_page').fadeOut('fast', function() {
      document.getElementById('room_page_username').innerHTML 
        = '<b> Username</b>: ' + username;
      $('.room_page').fadeIn('fast');
    });
  });
  $('#login').click(function() {
    $('.first_page').fadeOut('fast', function() {
      $('.login_page').fadeIn('fast');
    });
  });
  $('#sign_up').click(function() {
    $('.first_page').fadeOut('fast', function() {
      $('.sign_up_page').fadeIn('fast');
    });
  });
});

function set_username(user){
  username = user;
  document.getElementById('room_page_username').innerHTML 
    = '<b> Username</b>: ' + username;
}

// ******* LOGIN PAGE ******* //

socket.on('correct_login',function(user, genres){
  // User has enetered correct login 
  // and password redirects to room page
  document.getElementById('username').value = '';
  document.getElementById('pwd').value = '';
  set_username(user);
  user_genres = genres;
  set_genre_checkboxes();
  $('.login_page').fadeOut('fast', function() {
    $('.room_page').fadeIn('fast');
  });
}); 

function set_genre_checkboxes(){
  $.each(user_genres, function(index,genre){
    document.getElementById(genre).checked = true;
  });
}

socket.on('incorrect_login', function(message, password) {
  if (password) {
    document.getElementById('password_error_message').innerHTML = message;
  } else {
    document.getElementById('username_error_message').innerHTML = message;
  }
});

$(function(){
  $('#sign_in').click(function() {
    var username = document.getElementById('username').value;
    var password = document.getElementById('pwd').value;
    document.getElementById('username_error_message').innerHTML = '';
    document.getElementById('password_error_message').innerHTML = '';
    if (username.length < 1) {
      document.getElementById('username_error_message').innerHTML = 'Please enter a username';
    } else if (password.length < 1)
    {
      document.getElementById('password_error_message').innerHTML = 'Please enter a password';
    } else {
      socket.emit('sign_in', username, password);
    }
  });
 $('#login_page_back').click(function() {
   $('.login_page').fadeOut('fast', function() {
     $('.first_page').fadeIn('fast');
  });
 });
});

// ******* SIGN UP PAGE ******* //

socket.on('signed_in', function(user){
  document.getElementById('username_sign_up').value = '';
  document.getElementById('pwd_sign_up').value = '';
  set_username(user);
  $('.sign_up_page').fadeOut('fast', function() {
    $('.settings_page').fadeIn('fast');
  });
});

socket.on('user_already_exists', function(username){
  document.getElementById('username_error_message_sign_up').innerHTML 
      = "The username " + username + " already exists or starts with the word 'guest'";
});

$(function(){
  $('#sign_up_button').click(function() {
    var username = document.getElementById('username_sign_up').value;
    var password = document.getElementById('pwd_sign_up').value;
    document.getElementById('username_error_message_sign_up').innerHTML = '';
    document.getElementById('password_error_message_sign_up').innerHTML = '';
    if (username.length < 1) {
      document.getElementById('username_error_message_sign_up').innerHTML = 'Please enter a username';
    } else if (password.length < 1)
    {
      document.getElementById('password_error_message_sign_up').innerHTML = 'Please enter a password';
    } else {
      socket.emit('sign_up', username, password);
    }
  });
  $('#sign_up_back').click(function() {
    $('.sign_up_page').fadeOut('fast', function() {
       $('.first_page').fadeIn('fast');
  });
 });
});

// ******* SETTINGS PAGE ******* //

$(function(){
  $('#apply').click(function() {
    var genres = [];
    $('.genre_settings input[type=checkbox]').each(function() {
      if ($(this).is(":checked")) {
        genres.push($(this).attr('id').replace("_settings", ""));
        $(this).attr("checked", false);
      }
    }); 
    socket.emit('change_settings', username, genres);
    $.each(genres, function(index,genre){
      document.getElementById(genre).checked = true;
    });
    $('.settings_page').fadeOut('fast', function() {
      $('.room_page').fadeIn('fast');
    });
  });
});


// ******* ROOM PAGE ******* //

$(function(){
  $('#create').click(function() {
    socket.emit('new_room');
    $('.room_page').fadeOut('fast', function() {
      $('.lobby_page').fadeIn('fast');
    });
    is_admin = true;
    $('#go').show();
  });

  $('#RoomID').keydown(function(event){
    if(event.keyCode==13){
      event.preventDefault();
      $('#join').click();
    }
  });

  $('#join').click(function() {
    $('#room_message1').hide();
    $('#room_message2').hide();
    $('#gap').show();
    var RoomID = document.getElementById('RoomID').value;
    if (RoomID.length > 0){
      socket.emit("user_join", username, RoomID);
    }
    $('#go').hide();
  })
 $('#room_page_back').click(function() {
   $('.room_page').fadeOut('fast', function() {
     $('.first_page').fadeIn('fast');
   });
 });
});

function message_fade_out(element, time) {
  setTimeout(function() {
     element.fadeOut('slow');
  }, time);
}

socket.on('room_not_initialised', function(){
  $('#gap').hide();
  $('#room_message1').show(
    message_fade_out($('#room_message1'), 5000));
});

socket.on('room_is_locked', function() {
  $('#gap').hide();
  $('#room_message2').show(
    message_fade_out($('#room_message2'), 5000));
});

socket.on("joined_room", function(channel){
  room = channel;
  document.getElementById('myRoom').innerHTML = '<b> Your Room:</b> ' + room + '<br>';
  document.getElementById('lobby_page_username').innerHTML 
        = '<b> Username</b>: ' + username;
  $('.room_page').fadeOut('fast', function() {  
  $('.lobby_page').show();
});

});

socket.on('set_room_id', function(channel) {
    room = channel;
    socket.emit('user_join', username, room);
});

// ******* LOBBY PAGE ******* //

function initialise_film_page(film) {
  document.getElementById('image').src = film.poster_path;
  document.getElementById('title').innerHTML = film.title;
  document.getElementById('plot').innerHTML = film.shortPlot;
  document.getElementById('runtime').innerHTML = film.runtime;
  document.getElementById('imdbRating').innerHTML = film.imdbRating;
}


socket.on('show_film_page', function(film) {
  $('.overlay_message').fadeOut('fast', function(){
    $('.overlay').fadeOut();
  });
  on_main_page = true;
  //$('#chat').empty();
  initialise_film_page(film);
  $('.lobby_page').hide('fast', function() {
    $('.film_page').fadeIn('slow');
  });
});

$(function(){
  $('#go').click(function() {
    if (is_admin) {
      socket.emit('go_signal', room);
      //socket.emit('generate_films', room, genres);
    }
  });

 $('#lobby_page_back').click(function() {
   socket.emit('leave_room', username, room);
   $('.lobby_page').hide('fast', function() {
     $('.room_page').fadeIn('slow');
   });
   if (is_admin) {
     socket.emit('force_leave_signal', room);
     is_admin = false;
   }
 });
});

socket.on('waiting_signal', function() {
    var genres = [];
      $('.genres input[type=checkbox]').each(function() {
        if ($(this).is(":checked")) {
          genres.push($(this).attr('id'));
          $(this).attr("checked", false);
        }
      });
   socket.emit('user_add_genres', genres);

   $('.overlay').fadeIn();
   $('.overlay_message').show();
});

socket.on('force_leave', function() {
   socket.emit('leave_room', username, room);
   $('.lobby_page').hide('fast', function() {
       $('.room_page').fadeIn('fast'); 
       alert('Admin has left the room');
   });
});

// ******* FILM PAGE ******* //

$(function(){
  $('#yes').click(function() {
    socket.emit('choice', "yes", index, true);
  });
  $('#no').click(function() {
    socket.emit('choice', "no", index, false);
  });
  $('#datasend').click( function() {
    var message = $('#data').val();
    $('#data').val('');
    socket.emit('send_message', message);
  });
  $('#data').keypress(function(e) {
    if(e.which == 13) {
      $(this).blur();
      $('#datasend').focus().click();
    }
  });
});

socket.on('initialise', function(film) {
  document.getElementById('image').src = film.poster_path;
  document.getElementById('title').innerHTML = film.title;
  document.getElementById('plot').innerHTML = film.shortPlot;
  document.getElementById('runtime').innerHTML = film.runtime;
  document.getElementById('imdbRating').innerHTML = film.imdbRating;
});

socket.on('new_films', function(film, new_index) {
  index = new_index;
  $('#chat').append('Changing image! (Index at: ' + index + ') <br>');
  document.getElementById('image').src = film.poster_path;
  document.getElementById('title').innerHTML = film.title;
  document.getElementById('plot').innerHTML = film.shortPlot;
  document.getElementById('runtime').innerHTML = film.runtime;
  document.getElementById('imdbRating').innerHTML = film.imdbRating;
});

socket.on('update_chat', function(username, text) {
  $('#chat').append('<b>'+username + ':</b> ' + text + '<br>');
  var elem = document.getElementById('chat');
  elem.scrollTop = elem.scrollHeight;
});

socket.on('film_found', function(film) {
  on_main_page = false;
  socket.emit('leave_room', username, room);
  document.getElementById('found_film_title').innerHTML = film.title;
  document.getElementById('found_film_image').src = film.poster_path;
  // TODO: Show winning page;
  $('.film_page').hide("slow", function() {
    $('.found_page').fadeIn();
  });
  $('#chat').empty();
  $('#myRoom').empty();
  is_admin = false;
  index = 0;
});

// Keyboard shortcuts for 'yes' and 'no'

document.onkeydown = function(e) {
 if (on_main_page) {
  switch (e.keyCode) {
    case 37:
      socket.emit('choice', "yes", index, true);
      break;
    case 39:
      socket.emit('choice', "no", index, false);
      break;
  } 
 }
};

// ******* FOUND PAGE ******* //

$(function(){
  $('#film_found_confirm').click(function() {
     $('.found_page').hide("slow", function() {
       $('.room_page').fadeIn("slow");
     });
  });
});

