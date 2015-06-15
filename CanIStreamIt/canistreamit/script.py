from canistreamit import streaming, search

import sys, json

movie_info = search(sys.argv[1])

if (len(movie_info) > 0):

  movie = movie_info[0];

  stream_list = streaming(movie['_id'])

  dump = json.dumps(stream_list)

  print dump

else:
  
  print []

