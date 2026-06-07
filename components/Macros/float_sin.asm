
// Sine function --------------------------------------------------------------
// O(1) range reduction to [-pi/2, pi/2]: k = round(x/pi); r = x - k*pi; then
// sin(x) = (-1)^k * sin(r). sin(r) is a degree-7 odd minimax polynomial (the
// coefficients are a least-squares fit on [0, pi/2], max abs error ~1.6e-6 --
// ~6 digits, vs the old 152-point LUT's ~3). No lookup table, no new hardware.
// NB: F2I truncates toward zero, so round-to-nearest uses a sign-half bias.

@float_sin  SET   sin_x                  // save x
            F_MLT 0.3183098862           // q = x / pi   (1/pi)
            SET   sin_q
            LOD   0.5
            F_SGN sin_q                  // copysign(0.5, q)
            F_ADD sin_q                  // q + copysign(0.5,q)
            F2I                          // k = round(q)
            SET   sin_k                  // keep k (int) for the (-1)^k sign
            I2F                          // float(k)
            F_MLT 3.1415926536           // k * pi
            F_SU2 sin_x                  // r = x - k*pi  -> [-pi/2, pi/2]
            SET   sin_r
            F_MLT sin_r                  // w = r^2
            SET   sin_w

            LOD  -0.000184472138         // Horner in w: sin(r)/r = a1 + a3 w + a5 w^2 + a7 w^3
            F_MLT sin_w                  // a7
            F_ADD 0.008309516704         // a5
            F_MLT sin_w
            F_ADD -0.166651680787        // a3
            F_MLT sin_w
            F_ADD 0.999997487148         // a1
            F_MLT sin_r                  // * r  -> sin(r)
            SET   sin_p

            LOD   sin_k
            AND   1                      // k & 1  (parity)
            JIZ   L_sin_even             // k even -> +sin(r)
            LOD   sin_p
            F_NEG                        // k odd  -> -sin(r)
            RET
@L_sin_even LOD   sin_p
            RET
