<?php
// Al borrar el plugin se quitan sus ajustes
if (!defined('WP_UNINSTALL_PLUGIN')) exit;
delete_option('webcare_clave');
delete_option('webcare_estado');
delete_option('webcare_actualizaciones');
wp_clear_scheduled_hook('webcare_enviar');
