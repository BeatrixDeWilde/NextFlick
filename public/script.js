var id = window.location.pathname.substring(6);
var index = 0;
var socket = io.connect();
var username = 'NOTSET';
var room = 'NOTSET';
var on_main_page = false;
var on_film_found_page = false;
var is_admin = false;
var set_up = true;
var user_genres = [];
var email = 'NOTSET';

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
  "Sci-Fi",
  "Thriller",
  "War",
  "Western"
]

// *********************** //
// ******* GENERAL ******* //
// *********************** //

socket.on('update_user_list', function(users) {
  $('#users').empty();
  $.each(users, function(key, value) {
     $('#users').append('<div id='+value.username+'>   ' + value.username + '</div>');
        if (value.is_admin) {
          set_to_admin(value.username);
        } else {
          if (value.ready) {
            set_to_ready(value.username);
          } else {
            set_to_choosing(value.username);
          }
        }
  });
});

function set_to_choosing(username) {
  $('#'+username).append(' <span class="glyphicon glyphicon-option-horizontal"></span>');
}

function set_to_ready(username) {
  $('#'+username).append(' <span class="glyphicon glyphicon-ok" ></span>');
}

function set_to_admin(username) {
  $('#'+username).append(' <span class="glyphicon glyphicon-user"></span>');
}

function add_genre_checkboxes(genre_div, id_extension){
  var string = "";
  var first= true;
  string += "<table class='table'><tbody>";
  string += "<tr><td><div class='checkbox my_checkbox'><input type='checkbox' id='select_all'><label for='select_all'>Select All</label></div></td>";
  first=false;
  $.each(genreList, function(index, genre){
    if(first){
      string += "<tr><td><div class='checkbox my_checkbox gen'><input type='checkbox' id=" 
        + genre + id_extension + "><label for='" +genre + id_extension +"'>"+ genre + "</label></div></td>";
      first= false;
    }else{
      string += "<td><div class='checkbox my_checkbox gen'><input type='checkbox' id=" + genre + id_extension + 
        "><label for='" + genre + id_extension +"'>"+ genre + "</label></div></td></tr>";
      first = true;
    }
  });

  if(first){
    string += "</tr>";
  }

  string += "</tbody></table>";
  $(genre_div).append(string);
}



function set_genre_checkboxes(addition){
  $.each(user_genres, function(index,genre){
    document.getElementById(genre  + addition).checked = true;
  }); 
}

function reset_checkboxes(genre_class){
  $(genre_class + ' input[type=checkbox]').each(function() {
    if ($(this).is(":checked")) {
      $(this).attr("checked", false);
    }
  });
}

// Do this function when the webpage loads for the first time
$(document).ready(function() {
  add_genre_checkboxes('#genres','');
  add_genre_checkboxes('#genre_settings','_settings');
});

socket.on('popular_films', function(popular_films){
  $("#popular_film_list").html("");
  $.each(popular_films, function(index, film){
    $("#popular_film_list").append('<li><img src="' + film.poster_url + '" width="78" height="115" /></li>');
  });
  if (/^(guest)/.test(username)) {
    $("#scroller_title").html("Most frequent NextFlicks:");
  } else {
    $("#scroller_title").html(username + "'s recommended NextFlicks:");
  }
  scroll_films();
});

// Scrolling films:
function scroll_films(){
    var list_popular_films = $('#poster_scroller div.list_for_scroller');
    var width_of_viewing_area = list_popular_films.width();
    // Gets all the list elements in the list
    var popular_films = list_popular_films.children('ul');
    // Duplicates the list and adds it on the end
    popular_films.children().clone().appendTo(popular_films);
    var displacement = 0;
    popular_films.children().each(function(){
        // Sets the film posters displacement in the reel
        $(this).css('left', displacement);
        // Adds to current displacement another film image width 
        displacement += $(this).find('img').width();
    });
    // End of displacement so total length of reel
    var total_width_of_reel_of_films = displacement;
    var slider = {current_speed:0, full_speed:2};
    // Means it increments placement until the end of
    // the reel of two films then goes back to the beginning of the reel
    var scroll = function()
    {
        var current_placement = list_popular_films.scrollLeft();
        var new_placement = current_placement + slider.current_speed;
        // If at the end of the reel
        if (new_placement > total_width_of_reel_of_films - width_of_viewing_area){
          new_placement -= total_width_of_reel_of_films/2;
        }
        list_popular_films.scrollLeft(new_placement);
    };
    setInterval(scroll, 20);
    if (set_up) {
      $(slider).animate({current_speed:slider.full_speed}, 600);
      set_up = false;
    }
}

socket.on('connect', function(){
});

socket.on('set_username', function(user) {
  set_username(user);
});

// ************************** //
// ******* FIRST PAGE ******* //
// ************************** //

$(function(){
  // Fading out pages etc
  $('#guest').click(function() {
    socket.emit('get_guest_id');
    $('.first_page').fadeOut('fast', function() {
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
  socket.emit('get_popular_films', username);
}

// ************************** //
// ******* LOGIN PAGE ******* //
// ************************** //

socket.on('correct_login',function(user, genres, user_email){
  // User has enetered correct login 
  // and password redirects to room page
  document.getElementById('username').value = '';
  document.getElementById('pwd').value = '';
  set_username(user);
  user_genres = genres;
  email = user_email;
  $("#user_settings").show();
  $('.login_page').fadeOut('fast', function() {
    $('.room_page').fadeIn('fast');
  });
}); 

socket.on('incorrect_login', function(message, password) {
  if (password) {
    document.getElementById('password_error_message').innerHTML = message;
    $("#password_error_message").show();
    message_fade_out($('#password_error_message'), 5000);
  } else {
    document.getElementById('username_error_message').innerHTML = message;
    $("#username_error_message").show();
    message_fade_out($('#username_error_message'), 5000);
  }
});

$(function(){
  $('#sign_in').click(function() {
    var username = document.getElementById('username').value;
    var password = document.getElementById('pwd').value;
    document.getElementById('username_error_message').innerHTML = '';
    document.getElementById('password_error_message').innerHTML = '';
    if (username.length < 1) {
      document.getElementById('username_error_message').innerHTML = '<b>Please enter a username</b>';
      $("#username_error_message").show();
      message_fade_out($('#username_error_message'), 5000);
    } else if (password.length < 1)
    {
      document.getElementById('password_error_message').innerHTML = '<b>Please enter a password</b>';
      $("#password_error_message").show();
      message_fade_out($('#password_error_message'), 5000); 
    }
    else {
      socket.emit('sign_in', username, password);
    }
  });
  $('#login_page_back').click(function() {
    $('.login_page').fadeOut('fast', function() {
      $('.first_page').fadeIn('fast');
    });
  });
  $('#forgotten_password_button').click(function() {
    document.getElementById('pwd').value = '';
    var user = document.getElementById('username').value;
    if (user.length > 0) {
      socket.emit('forgotten_password',user);
      document.getElementById('username').value = '';
    }
    else {
      document.getElementById('username_error_message').innerHTML = "<b>Please enter a username</b>";
      $("#username_error_message").show();
      message_fade_out($('#username_error_message'), 5000);
    }
  });
});

socket.on('forgotten_password_user_exists', function(email_address, user, genres){
  socket.emit('send_email', email_address, user);
  document.getElementById('change_password_email').innerHTML = 'Email: ' + email_address;
  user_genres = genres;
  email = email_address;
  document.getElementById('change_password_username').innerHTML = 'User: ' + user;
  set_username(user);
  $('.login_page').fadeOut('fast', function() {
    $('.change_password_page').fadeIn('fast');
    $('#old_password').hide();
  });
});

// **************************** //
// ******* SIGN UP PAGE ******* //
// **************************** //

socket.on('signed_in', function(user, user_email){
  email = user_email;
  set_username(user);
  $('.sign_up_page').fadeOut('fast', function() {
    $('.settings_page').fadeIn('fast');
    $('#change_password_btn').hide();
  });
});

socket.on('user_already_exists', function(username){
  document.getElementById('username_error_message_sign_up').innerHTML = 
    '<b>The username ' + username + ' already exists</b>';
  $("#username_error_message_sign_up").show();
  message_fade_out($('#username_error_message_sign_up'), 5000);
});

$(function(){
  $('#sign_up_button').click(function() {
    var user = document.getElementById('username_sign_up').value;
    var password = document.getElementById('pwd_sign_up').value;
    var email = document.getElementById('email_sign_up').value;
    var regex_for_email = /^([\w-]+(?:\.[\w-]+)*)@((?:[\w-]+\.)*\w[\w-]{0,66})\.([a-z]{2,6}(?:\.[a-z]{2})?)$/i;
    document.getElementById('username_error_message_sign_up').innerHTML = '';
    document.getElementById('password_error_message_sign_up').innerHTML = '';
    document.getElementById('email_error_message_sign_up').innerHTML = '';
    document.getElementById('username_sign_up').value = '';
    document.getElementById('pwd_sign_up').value = '';
    document.getElementById('email_sign_up').value = '';
    if (user.length < 1) {
      document.getElementById('username_error_message_sign_up').innerHTML = '<b>Please enter a username</b>';
      $("#username_error_message_sign_up").show();
      message_fade_out($('#username_error_message_sign_up'), 5000);
    } else if (password.length < 1)
    {
      document.getElementById('password_error_message_sign_up').innerHTML = '<b>Please enter a password</b>';
      $("#password_error_message_sign_up").show();
      message_fade_out($('#password_error_message_sign_up'), 5000);
    } else if (email.length < 1 || !regex_for_email.test(email))
    {
      document.getElementById('email_error_message_sign_up').innerHTML = '<b>Please enter a valid email</b>';
      $("#email_error_message_sign_up").show();
      message_fade_out($('#email_error_message_sign_up'), 5000); 
    } else if (/^(guest)/.test(user)) {
      document.getElementById('username_error_message_sign_up').innerHTML = 
      '<b>The username ' + user + ' starts with the word "guest"</b>';
      $("#username_error_message_sign_up").show();
      message_fade_out($('#username_error_message_sign_up'), 5000);
    } else {
      socket.emit('sign_up', user, password, email);
    }
  });
  $('#sign_up_back').click(function() {
    $('.sign_up_page').fadeOut('fast', function() {
       $('.first_page').fadeIn('fast');
  });
 });
});

// ***************************** //
// ******* SETTINGS PAGE ******* //
// ***************************** //

$(function(){
  $('#apply').click(function() {
    var genres = [];
    $('#genre_settings input[type=checkbox]').each(function() {
      if ($(this).is(":checked")) {
        genres.push($(this).attr('id').replace("_settings", ""));
        $(this).attr("checked", false);
      }
    }); 
    user_genres = genres;
    socket.emit('change_settings', username, genres);
    change_settings_view();
  });
  $('#settings_back').click(function() {
    change_settings_view();
  });
  $('#change_password_btn').click(function() {
    $('.settings_page').fadeOut('fast', function() {
      $('.change_password_page').fadeIn('fast');
    });
    socket.emit('send_email', email, username);
  });
});

function change_settings_view(){
  $('#change_password_btn').show();
  $("#user_settings").show();
  reset_checkboxes('#genre_settings');
  $('.settings_page').fadeOut('fast', function() {
    $('.room_page').fadeIn('fast');
  });
}

// ************************************ //
// ******* CHANGE PASSWORD PAGE ******* //
// ************************************ //

$(function(){
  $('#change_password_back').click(function() {
    go_back();
  });
  $('#new_password').click(function() {
    var id = document.getElementById('unique_id').value;
    var new_password = document.getElementById('new_pwd_change').value;
    document.getElementById('change_pwd_error_message_settings').innerHTML = '';
    if ($('#old_password').is(":visible")) {
      var old_password = document.getElementById('old_pwd_change').value;
      if (old_password.length < 1) {
        change_pass_error("<b>Please enter an old password</b>");
      }
    }
    if (id.length < 1) {
      change_pass_error("<b>Please enter a valid id</b>");
    } else if (new_password.length < 1) {
      change_pass_error("<b>Please enter a new password</b>");
    }
    else {
      socket.emit('change_password', id, username, old_password, new_password, !$('#old_password').is(":visible"));
    }
  });
});

function change_pass_error(message){
  document.getElementById('change_pwd_error_message_settings').innerHTML = message;
  $("#change_pwd_error_message_settings").show();
  message_fade_out($('#change_pwd_error_message_settings'), 5000);
}

socket.on('incorrect_input', function(message){
  change_pass_error(message);
});

socket.on('changed_password', function(user){
  if ($('#old_password').is(":visible")) {
    go_back();
  } else {
    leave_forgotten_password();
    set_username(user);
    $("#user_settings").show();
    $('.change_password_page').fadeOut('fast', function() {
      $('.room_page').fadeIn('fast');
    });
  }
});

function leave_forgotten_password(){
  document.getElementById('unique_id').value = '';
  document.getElementById('new_pwd_change').value = '';
  $('#old_password').show();
}

function go_back(){
  document.getElementById('unique_id').value = '';
  document.getElementById('new_pwd_change').value = '';
  if ($('#old_password').is(":visible")) {
    document.getElementById('old_pwd_change').value = '';
    $('.change_password_page').fadeOut('fast', function() {
      $('.settings_page').fadeIn('fast');
    });
  } else{
    leave_forgotten_password();
    $('.change_password_page').fadeOut('fast', function() {
      $('.login_page').fadeIn('fast');
    });
  }
}


// ************************* //
// ******* ROOM PAGE ******* //
// ************************* //

$(function(){
  $('#create').click(function() {
    socket.emit('new_room');
    is_admin = true;
    $('#go').show();
    $('#options').show();
    $('#ready').hide();
  });

  $('#RoomID').keydown(function(event){
    if(event.keyCode==13){
      event.preventDefault();
      $('#join').click();
    }
  });

  $('#user_settings').click(function() {
    $(".non_sign_up_settings").show();
    set_genre_checkboxes('_settings');
    document.getElementById('settings_email').innerHTML = 'Email: ' + email;
    document.getElementById('settings_username').innerHTML = 'User: ' + username;
    document.getElementById('change_password_email').innerHTML = 'Email: ' + email;
    document.getElementById('change_password_username').innerHTML = 'User: ' + username;
    $('.room_page').fadeOut('fast', function() {
      $('.settings_page').fadeIn('fast');
    });
  });

  $('#join').click(function() {
    $('#room_message1').hide();
    $('#room_message2').hide();
    var RoomID = document.getElementById('RoomID').value;
    if (RoomID.length > 0){
      socket.emit("user_join", username, RoomID, is_admin);
    }
    document.getElementById('RoomID').value = '';
    $('#go').hide();
    $('#options').hide();
    $('#ready').show();
    $('#ready').removeAttr("disabled");
    enable_checkboxes();
  });
  $('#room_page_back').click(function() {
    email = 'NOTSET';
    socket.emit('reset_user', username);
    username = 'NOTSET';
    $("#user_settings").hide();
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
  $('#room_message1').show(
    message_fade_out($('#room_message1'), 5000));
});

socket.on('room_is_locked', function() {
  $('#room_message2').show(
    message_fade_out($('#room_message2'), 5000));
});

socket.on("joined_room", function(channel){
  room = channel;
  document.getElementById('myRoom').innerHTML = '<b> Your Room:</b> ' + room + '<br>';
  document.getElementById('lobby_page_username').innerHTML 
    = '<b> Username</b>: ' + username;
  set_up_lobby_page();
  $('.room_page').fadeOut('fast', function() {
    $('.lobby_page').show();
  });
});

socket.on('set_room_id', function(channel) {
  room = channel;
  socket.emit('user_join', username, room, is_admin);
});

function set_up_lobby_page() {
  set_genre_checkboxes('');
}

// ************************** //
// ******* LOBBY PAGE ******* //
// ************************** //


function initialise_film_page(film) {
  document.getElementById('image').src = film.poster_path;
  document.getElementById('title').innerHTML = film.title;
  document.getElementById('plot').innerHTML = film.shortPlot;
  document.getElementById('runtime').innerHTML = film.runtime;
  document.getElementById('imdbRating').innerHTML = film.imdbRating;
  if (film.onNetflix) {
    document.getElementById('onNetflix').innerHTML = '<span class="glyphicon glyphicon-ok"></span>';
  } else {
    document.getElementById('onNetflix').innerHTML = '<span class="glyphicon glyphicon-remove"></span>';
  }
  if (film.onAIV) {
    document.getElementById('onAIV').innerHTML = '<span class="glyphicon glyphicon-ok"></span>';
  } else {
    document.getElementById('onAIV').innerHTML = '<span class="glyphicon glyphicon-remove"></span>';
  }
  $("img").on("dragstart", function(event){
    event.preventDefault();
  });
}


socket.on('show_film_page', function(film) {
  $('#room_build_overlay_message').fadeOut('fast', function(){
    enable_checkboxes();
    $('#room_build_overlay').fadeOut();
  });
  on_main_page = true;
  //$('#chat').empty();
  initialise_film_page(film);
  reset_checkboxes('#genres');
  $('.lobby_page').hide('fast', function() {
    $('.film_page').fadeIn('slow');
    adjustTitle();
    var my_image = document.getElementById('image_block');
    var touch_input = new Hammer(my_image);
    touch_input.get('swipe').set({velocity:0.1, threshold: 3});
    touch_input.on("swipeleft", function(){
      socket.emit('choice', "no", index, false);
    });
    touch_input.on("swiperight", function(){
      socket.emit('choice', "yes", index, true);
    });

  });
});

$(function(){
  $('#go').click(function() {
    if (is_admin) {
      socket.emit('go_signal', room);
      socket.emit('add_runtime_filter', $("#selection input[name='runtime']:checked").val());
      //socket.emit('generate_films', room, genres);
    }
  });

 $('#lobby_page_back').click(function() {
   socket.emit('leave_room', username, room);
   reset_checkboxes('#genres');
   $('.lobby_page').fadeOut('fast', function() {
     enable_checkboxes();
     $('#ready').removeAttr("disabled");
     $('.room_page').fadeIn('fast');
   });
   if (is_admin) {
     socket.emit('force_leave_signal', room);
     is_admin = false;
   }
 });
 $('#ready').click(function() {
   socket.emit('ready_signal', username, room);
   $('#ready').attr("disabled", true);
   $('#genre_overlay').fadeIn();
   disable_checkboxes();
 });

 $('#select_all').click(function(){
  $('input:checkbox').not(this).prop('checked', this.checked);
});

});

function disable_checkboxes() {
  $('#genre_overlay').fadeIn('slow');
}

function enable_checkboxes() {
  $('#genre_overlay').hide();
}

socket.on('waiting_signal', function() {
    var genres = [];
      $('#genres input[type=checkbox]').each(function() {
        if ($(this).is(":checked")) {
          genres.push($(this).attr('id'));
          $(this).attr("checked", false);
        }
      });
   socket.emit('user_add_genres', genres);

   $('#room_build_overlay').fadeIn();
   $('#room_build_overlay_message').show();
});

socket.on('force_leave', function() {
   socket.emit('leave_room', username, room);
   reset_checkboxes('#genres');
   $('.lobby_page').hide('fast', function() {
       $('.film_page').hide('fast');
       $('.room_page').fadeIn('fast'); 
       alert('Admin has left the room');
   });
});

// ************************* //
// ******* FILM PAGE ******* //
// ************************* //

$(function(){
  $('#yes').click(function() {
    socket.emit('choice', "yes", index, true);
  });
  $('#no').click(function() {
    socket.emit('choice', "no", index, false);
  });
});


socket.on('new_films', function(film, new_index) {
  index = new_index;
  $('#chat').append('Changing image! (Index at: ' + index + ') <br>');
  document.getElementById('image').src = film.poster_path;
  document.getElementById('title').innerHTML = film.title;
  adjustTitle();
  document.getElementById('plot').innerHTML = film.shortPlot;
  document.getElementById('runtime').innerHTML = film.runtime;
  document.getElementById('imdbRating').innerHTML = film.imdbRating;
  if (film.onNetflix) {
    document.getElementById('onNetflix').innerHTML = '<span class="glyphicon glyphicon-ok"></span>';
  } else {
    document.getElementById('onNetflix').innerHTML = '<span class="glyphicon glyphicon-remove"></span>';
  }
  if (film.onAIV) {
    document.getElementById('onAIV').innerHTML = '<span class="glyphicon glyphicon-ok"></span>';
  } else {
    document.getElementById('onAIV').innerHTML = '<span class="glyphicon glyphicon-remove"></span>';
  }
});

function adjustTitle(){
  var fontSize = 29;
  do{
     fontSize--;
    $('#title').css('font-size', fontSize.toString() + 'px');
  } while($('#title').height() >= $('#title_block').height());
}

socket.on('film_found', function(film) {
  on_main_page = false;
  on_film_found_page = true;
  socket.emit('leave_room', username, room);
  document.getElementById('found_film_title').innerHTML = film.title;
  document.getElementById('found_film_image').src = film.poster_path;

  // Set watching options buttons to netflix/AIV links or disable buttons
  if (film.onNetflix && film.linkNetflix != null) {
    document.getElementById('watchNetflix').href = film.linkNetflix;
    $('#watchNetflix').attr('disabled', false);
  } else {
    document.getElementById('watchNetflix').href = '';
    $('#watchNetflix').attr('disabled', true);
  }
  if (film.onAIV && film.linkAIV != null) {
    document.getElementById('watchAmazon').href = film.linkAIV;
    $('#watchAmazon').attr('disabled', false);
  } else {
    document.getElementById('watchAmazon').href = '';
    $('#watchAmazon').attr('disabled', true);
  }

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
    case 39:
      socket.emit('choice', "yes", index, true);
      break;
    case 37:
      socket.emit('choice', "no", index, false);
      break;
    case 40:
      $('#filmInfoBtn').trigger('click');
      break;
  } 
 } 
 if(on_film_found_page){
  switch(e.keyCode){
    case 13:
      $('#film_found_confirm').trigger('click');
    break;
  }
 } 
};

// ************************** //
// ******* FOUND PAGE ******* //
// ************************** //

$(function(){
  $('#film_found_confirm').click(function() {
    on_film_found_page = false;
     $('.found_page').hide("slow", function() {
       $('.room_page').fadeIn("slow");
     });
  });
});

