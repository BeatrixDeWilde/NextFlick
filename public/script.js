var id = window.location.pathname.substring(6);
var index = 0;
var socket = io.connect('http://localhost:8080');
var username = 'NOTSET';
var room = 'NOTSET';
var on_main_page = false;
var is_admin = false;

// ******* GENERAL ******* //

socket.on('update_user_list', function(users) {
$('#users').empty();
$('#main_page_users').empty();
  $.each(users, function(key, value) {
    $('#users').append('<div>' + value+ '</div>');
    $('#main_page_users').append('<div>' + value + '</div>');
  });
});

socket.on('connect', function(){
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

// ******* LOGIN PAGE ******* //

socket.on('correct_login',function(user){
  // User has enetered correct login 
  // and password redirects to room page
  document.getElementById('username').value = '';
  document.getElementById('pwd').value = '';
  username = user;
  $('.login_page').fadeOut('fast', function() {
    $('.room_page').fadeIn('fast');
  });
}); 

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
});

// ******* SIGN UP PAGE ******* //

socket.on('signed_in', function(user){
  document.getElementById('username_sign_up').value = '';
  document.getElementById('pwd_sign_up').value = '';
  username = user;
  $('.sign_up_page').fadeOut('fast', function() {
    $('.room_page').fadeIn('fast');
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

  $('#join').click(function() {
    $('#room_message1').hide();
    $('#room_message2').hide();
    var RoomID = document.getElementById('RoomID').value;
    if (RoomID.length > 0){
      socket.emit("user_join", username, RoomID);
    }
    $('#go').hide();
  });
});

socket.on('room_not_initialised', function(){
 $('#room_message1').show();
});

socket.on('room_is_locked', function() {
   $('#room_message2').show();
});

socket.on("joined_room", function(channel){
  room = channel;
  //$('#myRoom').append('<b> Your Room:</b> ' + room + '<br>');
  document.getElementById('myRoom').innerHTML = '<b> Your Room:</b> ' + room + '<br>';
  $('.room_page').fadeOut('fast', function() {
    $('.lobby_page').show();
  });
});

socket.on('set_room_id', function(channel) {
    room = channel;
    socket.emit('user_join', username, room);
});

// ******* LOBBY PAGE ******* //

$(function(){
  $('#go').click(function() {
    $('#chat').empty();
    socket.emit('generate_films', room);
    $('.lobby_page').hide('fast', function() {
      $('.film_page').fadeTo('slow', 1);
    });
    on_main_page = true;
    if (is_admin) {
       socket.emit('force_go_signal', room);
    }
    });
});

socket.on('force_go', function() {
   $('.lobby_page').hide('fast', function() {
      $('.film_page').fadeTo('slow', 1);
    });
    $('#chat').empty();
    on_main_page = true;
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
});

socket.on('new_films', function(film, new_index) {
  index = new_index;
  $('#chat').append('Changing image! (Index at: ' + index + ') <br>');
  document.getElementById('image').src = film.poster_path;
  document.getElementById('title').innerHTML = film.title;
});

/*socket.on('new_film', function(url){
    $('#chat').append('Changing image!<br>');
    document.getElementById('image').src = url;
}); */

socket.on('update_chat', function(username, text) {
     $('#chat').append('<b>'+username + ':</b> ' + text + '<br>');
     var elem = document.getElementById('chat');
     elem.scrollTop = elem.scrollHeight;
});

socket.on('film_found', function(film) {
  //alert('Film found! Film: ' + film.title + ' \nTODO: Work on this splash page. Will redirect to main page for now.');
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

