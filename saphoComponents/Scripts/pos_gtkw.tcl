gtkwave::/View/Left_Justified_Signals
# engana bug -> cria uma aba vazia no gtkwave. refresh soh funciona assim com o GTK3
gtkwave::loadFile "fix.vcd"
gtkwave::setTabActive 0