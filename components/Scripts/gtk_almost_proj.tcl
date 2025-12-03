# Visualizacao ----------------------------------------------------------------

gtkwave::/Time/Zoom/Zoom_Best_Fit
gtkwave::/View/Left_Justified_Signals

# engana bug -> cria uma aba vazia no gtkwave. refresh soh funciona assim com o GTK3
gtkwave::/File/Open_New_Tab "fix.vcd"
gtkwave::setTabActive 0