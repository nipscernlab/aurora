# Separador de I/O ------------------------------------------------------------

gtkwave::/Edit/Insert_Comment {Sinais *************}

# Insere o clock e o reset --------------------------------------------------------------

set nfacs [gtkwave::getNumFacs]

for {set i 0} {$i < $nfacs } {incr i} {
    set f_out_en [gtkwave::getFacName $i]

    set index [string first id.out_en $f_out_en]
    if {$index != -1} {
        break
    }
}

for {set i 0} {$i < $nfacs } {incr i} {
    set f_req_in [gtkwave::getFacName $i]

    set index [string first id.req_in $f_req_in]
    if {$index != -1} {
        break
    }
}

set filter [list clk rst $f_req_in $f_out_en]
gtkwave::addSignalsFromList $filter

# Separador de I/O ------------------------------------------------------------

gtkwave::/Edit/Insert_Comment {I/O ****************}

# Sinais de entrada -----------------------------------------------------------

set j 0
for {set i 0} {$i < $nfacs } {incr i} {
    set facname [gtkwave::getFacName $i]

    set index [string first tb.in_ $facname]
    if {$index != -1} {
        set filter [list $facname]
        gtkwave::addSignalsFromList $filter
        gtkwave::highlightSignalsFromList $filter
        gtkwave::/Edit/Data_Format/Signed_Decimal
        gtkwave::/Edit/Color_Format/Yellow
        set nome [list Entrada $j]
        gtkwave::/Edit/Alias_Highlighted_Trace $nome
        incr j
    }
}

# Sinais de saida -------------------------------------------------------------

set j 0
for {set i 0} {$i < $nfacs } {incr i} {
    set facname [gtkwave::getFacName $i]

    set index [string first tb.out_ $facname]
    if {$index != -1} {
        set filter [list $facname]
        gtkwave::addSignalsFromList $filter
        gtkwave::highlightSignalsFromList $filter
        gtkwave::/Edit/Data_Format/Signed_Decimal
        gtkwave::/Edit/Color_Format/Orange
        set nome [list Saída $j]
        gtkwave::/Edit/Alias_Highlighted_Trace $nome
        incr j
    }
}

# Separador de Instrucoes -----------------------------------------------------

gtkwave::/Edit/Insert_Comment {Instruções *********}

# Assembly --------------------------------------------------------------------

set tradutor [gtkwave::setCurrentTranslateFile trad_opcode.txt]

for {set i 0} {$i < $nfacs } {incr i} {
    set facname [gtkwave::getFacName $i]

    set index [string first pc.valr2 $facname]
    if {$index != -1} {
        set filter [list $facname]
        gtkwave::addSignalsFromList $filter
        gtkwave::highlightSignalsFromList $filter
        gtkwave::/Edit/Data_Format/Decimal
        gtkwave::/Edit/Color_Format/Indigo
        gtkwave::installFileFilter $tradutor
        gtkwave::/Edit/Alias_Highlighted_Trace Assembly
    }
}

# C+- -------------------------------------------------------------------------

set tradutor [gtkwave::setCurrentTranslateFile trad_cmm.txt]

for {set i 0} {$i < $nfacs } {incr i} {
    set facname [gtkwave::getFacName $i]

    set index [string first pc.linetabs $facname]
    if {$index != -1} {
        set filter [list $facname]
        gtkwave::addSignalsFromList $filter
        gtkwave::highlightSignalsFromList $filter
        gtkwave::/Edit/Data_Format/Signed_Decimal
        gtkwave::/Edit/Color_Format/Violet
        gtkwave::installFileFilter $tradutor
        gtkwave::/Edit/Alias_Highlighted_Trace C+-
    }
}

# Separador de Variaveis ------------------------------------------------------

gtkwave::/Edit/Insert_Comment {Variáveis **********}

# Tipo int --------------------------------------------------------------------

set var_n 0
set var_int [list]
set var_int_func [list]
set var_int_name [list]
for {set i 0} {$i < $nfacs } {incr i} {
    set facname [gtkwave::getFacName $i]

    set index [string first mdata.me1 $facname]
    if {$index != -1} {
        incr var_n
        lappend var_int $facname

        # pega funcao
        set findex [expr $index + 10]
        for {set j $findex} {$j < [string length $facname]} {incr j} {
            set char [string index $facname $j]
            if {[string compare $char "_"] == 0} {
                set lindex $j
                break
            }
        }
        set funcao [string range $facname $findex [expr $lindex -1]]
        lappend var_int_func $funcao

        # pega variavel
        set findex [expr $j + 1]
        for {set j $findex} {$j < [string length $facname]} {incr j} {
            set char [string index $facname $j]
            if {[string compare $char {[}] == 0} {
                set lindex $j
                break
            }
        }
        set variaveis [string range $facname $findex [expr $lindex -1]]
        lappend var_int_name $variaveis
	}
}

set v_int [gtkwave::setCurrentTranslateProc f2i_gtkw.exe]
gtkwave::addSignalsFromList $var_int
gtkwave::/Edit/Data_Format/Decimal
gtkwave::installProcFilter $v_int
gtkwave::/Edit/UnHighlight_All

for {set i 0} {$i < $var_n } {incr i} {
    set facname [lindex $var_int $i]
    set target [list $facname]
    gtkwave::highlightSignalsFromList $target
    set name [lindex $var_int_name $i]
    set func [lindex $var_int_func $i]
    set ftmp [list int $name em $func]
    set par {()}
    gtkwave::/Edit/Alias_Highlighted_Trace $ftmp$par
    gtkwave::/Edit/UnHighlight_All
}

# Tipo float ------------------------------------------------------------------

set var_n 0
set var_float [list]
set var_float_func [list]
set var_float_name [list]
for {set i 0} {$i < $nfacs } {incr i} {
    set facname [gtkwave::getFacName $i]

    set index [string first mdata.me2 $facname]
    if {$index != -1} {
        incr var_n
        lappend var_float $facname

        # pega funcao
        set findex [expr $index + 10]
        for {set j $findex} {$j < [string length $facname]} {incr j} {
            set char [string index $facname $j]
            if {[string compare $char "_"] == 0} {
                set lindex $j
                break
            }
        }
        set funcao [string range $facname $findex [expr $lindex -1]]
        lappend var_float_func $funcao

        # pega variavel
        set findex [expr $j + 1]
        for {set j $findex} {$j < [string length $facname]} {incr j} {
            set char [string index $facname $j]
            if {[string compare $char {[}] == 0} {
                set lindex $j
                break
            }
        }
        set variaveis [string range $facname $findex [expr $lindex -1]]
        lappend var_float_name $variaveis
	}
}

set v_float [gtkwave::setCurrentTranslateProc float2gtkw.exe]
gtkwave::addSignalsFromList $var_float
gtkwave::/Edit/Data_Format/Decimal
gtkwave::installProcFilter $v_float
gtkwave::/Edit/UnHighlight_All

for {set i 0} {$i < $var_n } {incr i} {
    set facname [lindex $var_float $i]
    set target [list $facname]
    gtkwave::highlightSignalsFromList $target
    set name [lindex $var_float_name $i]
    set func [lindex $var_float_func $i]
    set ftmp [list float $name em $func]
    set par {()}
    gtkwave::/Edit/Alias_Highlighted_Trace $ftmp$par
    gtkwave::/Edit/UnHighlight_All
}

# Tipo comp -------------------------------------------------------------------

set var_n 0
set var_comp [list]
set var_comp_func [list]
set var_comp_name [list]
for {set i 0} {$i < $nfacs } {incr i} {
    set facname [gtkwave::getFacName $i]

    set index [string first mdata.comp_me3 $facname]
    if {$index != -1} {
        incr var_n
        lappend var_comp $facname

        # pega funcao
        set findex [expr $index + 15]
        for {set j $findex} {$j < [string length $facname]} {incr j} {
            set char [string index $facname $j]
            if {[string compare $char "_"] == 0} {
                set lindex $j
                break
            }
        }
        set funcao [string range $facname $findex [expr $lindex -1]]
        lappend var_comp_func $funcao

        # pega variavel
        set findex [expr $j + 1]
        for {set j $findex} {$j < [string length $facname]} {incr j} {
            set char [string index $facname $j]
            if {[string compare $char {[}] == 0} {
                set lindex $j
                break
            }
        }
        set variaveis [string range $facname $findex [expr $lindex -1]]
        lappend var_comp_name $variaveis
	}
}

set v_comp [gtkwave::setCurrentTranslateProc comp2gtkw.exe]
gtkwave::addSignalsFromList $var_comp
gtkwave::/Edit/Data_Format/Binary
gtkwave::installProcFilter $v_comp
gtkwave::/Edit/UnHighlight_All

for {set i 0} {$i < $var_n } {incr i} {
    set facname [lindex $var_comp $i]
    set target [list $facname]
    gtkwave::highlightSignalsFromList $target
    set name [lindex $var_comp_name $i]
    set func [lindex $var_comp_func $i]
    set ftmp [list comp $name em $func]
    set par {()}
    gtkwave::/Edit/Alias_Highlighted_Trace $ftmp$par
    gtkwave::/Edit/UnHighlight_All
}  

# Visualizacao ----------------------------------------------------------------
gtkwave::/Time/Zoom/Zoom_Best_Fit
gtkwave::/View/Left_Justified_Signals