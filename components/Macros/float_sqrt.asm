
// sqrt function --------------------------------------------------------------

@float_sqrt     SET sqrt_num       // get the parameter
              F_ROT                // first estimate (nearest power of 2)

                PSH                // update x
              F_DIV sqrt_num       // iteration 1
             SF_ADD
              F_MLT 0.5

                PSH                // update x
              F_DIV sqrt_num       // iteration 2
             SF_ADD
              F_MLT 0.5

                PSH                // update x
              F_DIV sqrt_num       // iteration 3
             SF_ADD
              F_MLT 0.5

                PSH                // update x
              F_DIV sqrt_num       // iteration 4
             SF_ADD
              F_MLT 0.5

                RET
