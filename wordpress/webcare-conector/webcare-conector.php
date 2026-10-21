<?php
/**
 * Plugin Name: Velority Conector
 * Description: Envía cada día a tu panel de Velority el estado de la web: actualizaciones del mes, ataques bloqueados y amenazas (Wordfence) y copias de seguridad (UpdraftPlus).
 * Version: 1.0.1
 * Requires at least: 5.8
 * Requires PHP: 7.4
 * Author: Velority
 * License: GPL-2.0-or-later
 * Text Domain: webcare-conector
 */

if (!defined('ABSPATH')) exit;

define('WEBCARE_VERSION', '1.0.1');
define('WEBCARE_URL', 'https://ufwuvbjrgvphbggkfkuh.supabase.co/functions/v1/wp');

// ---------- Envío diario ----------
register_activation_hook(__FILE__, function () {
    if (!wp_next_scheduled('webcare_enviar')) wp_schedule_event(time() + 300, 'daily', 'webcare_enviar');
});
register_deactivation_hook(__FILE__, function () {
    wp_clear_scheduled_hook('webcare_enviar');
});
add_action('webcare_enviar', 'webcare_enviar');

// ---------- Actualizaciones hechas este mes (plugins, temas y núcleo; también las automáticas) ----------
add_action('upgrader_process_complete', function ($upgrader, $extra) {
    if (empty($extra['action']) || $extra['action'] !== 'update' || empty($extra['type'])) return;
    $n = 0;
    if ($extra['type'] === 'plugin') $n = !empty($extra['plugins']) ? count((array) $extra['plugins']) : (!empty($extra['plugin']) ? 1 : 0);
    elseif ($extra['type'] === 'theme') $n = !empty($extra['themes']) ? count((array) $extra['themes']) : (!empty($extra['theme']) ? 1 : 0);
    elseif ($extra['type'] === 'core') $n = 1;
    if (!$n) return;
    $mes = gmdate('Y-m');
    $act = get_option('webcare_actualizaciones', array());
    $act = (is_array($act) && isset($act['mes']) && $act['mes'] === $mes) ? $act : array('mes' => $mes, 'n' => 0);
    $act['n'] += $n;
    update_option('webcare_actualizaciones', $act, false);
}, 10, 2);

function webcare_actualizaciones_mes() {
    $act = get_option('webcare_actualizaciones', array());
    return (is_array($act) && isset($act['mes']) && $act['mes'] === gmdate('Y-m')) ? (int) $act['n'] : 0;
}

// Tabla de otro plugin (Wordfence usa minúsculas en versiones recientes)
function webcare_tabla($nombre) {
    global $wpdb;
    foreach (array($wpdb->base_prefix . $nombre, $wpdb->base_prefix . strtolower($nombre)) as $t) {
        if ($wpdb->get_var($wpdb->prepare('SHOW TABLES LIKE %s', $t)) === $t) return $t;
    }
    return null;
}

// ---------- Datos que se envían ----------
function webcare_datos() {
    global $wpdb;
    $d = array(
        'sitio' => home_url(),
        'wp' => get_bloginfo('version'),
        'php' => PHP_VERSION,
        'actualizaciones_mes' => webcare_actualizaciones_mes(),
    );

    // Seguridad: Wordfence
    if (defined('WORDFENCE_VERSION')) {
        $d['seguridad'] = 'Wordfence';
        $t = webcare_tabla('wfBlockedIPLog');
        if ($t) {
            $dia = (int) floor(strtotime(gmdate('Y-m-01 00:00:00')) / 86400);
            $d['ataques_mes'] = (int) $wpdb->get_var($wpdb->prepare("SELECT COALESCE(SUM(blockCount), 0) FROM `$t` WHERE unixday >= %d", $dia));
        }
        $t = webcare_tabla('wfIssues');
        if ($t) $d['amenazas'] = (int) $wpdb->get_var("SELECT COUNT(*) FROM `$t` WHERE status = 'new'");
    }

    // Copias de seguridad: UpdraftPlus
    if (class_exists('UpdraftPlus') || defined('UPDRAFTPLUS_DIR')) {
        $d['copias_con'] = 'UpdraftPlus';
        $ultima = get_option('updraft_last_backup');
        if (is_array($ultima) && !empty($ultima['backup_time'])) $d['ultima_copia'] = gmdate('c', (int) $ultima['backup_time']);
        $historial = get_option('updraft_backup_history');
        if (is_array($historial)) $d['copias'] = count($historial);
    }

    // Actualizaciones pendientes
    $p = get_site_transient('update_plugins');
    $t = get_site_transient('update_themes');
    $c = get_site_transient('update_core');
    $nucleo = 0;
    if ($c && !empty($c->updates)) foreach ($c->updates as $u) if (isset($u->response) && $u->response === 'upgrade') { $nucleo = 1; break; }
    $d['pendientes'] = array(
        'nucleo' => $nucleo,
        'plugins' => ($p && !empty($p->response)) ? count($p->response) : 0,
        'temas' => ($t && !empty($t->response)) ? count($t->response) : 0,
    );
    return $d;
}

function webcare_enviar() {
    $clave = trim((string) get_option('webcare_clave', ''));
    if ($clave === '') return array('ok' => false, 'msg' => 'Falta la clave de conexión.');
    $r = wp_remote_post(WEBCARE_URL, array(
        'timeout' => 20,
        'headers' => array('Content-Type' => 'application/json'),
        'body' => wp_json_encode(array('clave' => $clave, 'version_plugin' => WEBCARE_VERSION, 'datos' => webcare_datos())),
    ));
    if (is_wp_error($r)) {
        $res = array('ok' => false, 'msg' => 'No se pudo conectar: ' . $r->get_error_message());
    } else {
        $j = json_decode(wp_remote_retrieve_body($r), true);
        $res = (wp_remote_retrieve_response_code($r) === 200 && !empty($j['ok']))
            ? array('ok' => true, 'msg' => 'Conectado' . (!empty($j['cliente']) ? ' como ' . $j['cliente'] : '') . '.')
            : array('ok' => false, 'msg' => !empty($j['error']) ? $j['error'] : 'Error ' . wp_remote_retrieve_response_code($r) . '.');
    }
    $res['cuando'] = time();
    update_option('webcare_estado', $res, false);
    return $res;
}

// ---------- Ajustes > Velority ----------
add_action('admin_menu', function () {
    add_options_page('Velority', 'Velority', 'manage_options', 'webcare', 'webcare_pagina');
});

add_action('admin_post_webcare_guardar', function () {
    if (!current_user_can('manage_options')) wp_die('Sin permiso.');
    check_admin_referer('webcare_guardar');
    update_option('webcare_clave', sanitize_text_field(wp_unslash($_POST['webcare_clave'] ?? '')), false);
    if (!wp_next_scheduled('webcare_enviar')) wp_schedule_event(time() + 300, 'daily', 'webcare_enviar');
    webcare_enviar();
    wp_safe_redirect(admin_url('options-general.php?page=webcare'));
    exit;
});

function webcare_pagina() {
    if (!current_user_can('manage_options')) return;
    $estado = get_option('webcare_estado', array());
    $clave = (string) get_option('webcare_clave', '');
    $d = webcare_datos();
    $si = '<span style="color:#008a20">✔</span> ';
    $no = '<span style="color:#b32d2e">✘</span> ';
    ?>
    <div class="wrap">
        <h1>Velority</h1>
        <p>Este plugin envía una vez al día a tu panel de Velority el estado de tu web, para que lo veas en tu portal sin que nadie tenga que apuntarlo a mano.</p>
        <form method="post" action="<?php echo esc_url(admin_url('admin-post.php')); ?>">
            <input type="hidden" name="action" value="webcare_guardar">
            <?php wp_nonce_field('webcare_guardar'); ?>
            <table class="form-table" role="presentation">
                <tr>
                    <th scope="row"><label for="webcare_clave">Clave de conexión</label></th>
                    <td>
                        <input name="webcare_clave" id="webcare_clave" type="password" class="regular-text code" value="<?php echo esc_attr($clave); ?>" autocomplete="off" placeholder="wc_…">
                        <p class="description">Te la da el equipo de Velority (panel &gt; ficha del cliente &gt; «Conectar WordPress»).</p>
                    </td>
                </tr>
                <tr>
                    <th scope="row">Estado</th>
                    <td>
                        <?php if (!empty($estado['cuando'])) : ?>
                            <?php echo $estado['ok'] ? $si : $no; ?><?php echo esc_html($estado['msg']); ?>
                            <span class="description">(<?php echo esc_html(sprintf('hace %s', human_time_diff((int) $estado['cuando']))); ?>)</span>
                        <?php else : ?>
                            Todavía no se ha enviado nada.
                        <?php endif; ?>
                    </td>
                </tr>
            </table>
            <?php submit_button('Guardar y probar la conexión'); ?>
        </form>
        <h2>Qué se envía</h2>
        <ul>
            <li><?php echo $si; ?>Actualizaciones hechas este mes: <strong><?php echo (int) $d['actualizaciones_mes']; ?></strong></li>
            <li><?php echo isset($d['seguridad']) ? $si . 'Ataques bloqueados y amenazas (Wordfence)' : $no . 'Ataques y amenazas: instala Wordfence para enviarlos'; ?></li>
            <li><?php echo isset($d['copias_con']) ? $si . 'Copias de seguridad (UpdraftPlus)' : $no . 'Copias de seguridad: instala UpdraftPlus para enviarlas'; ?></li>
            <li><?php echo $si; ?>Versión de WordPress y PHP, y actualizaciones pendientes</li>
        </ul>
        <p class="description">No se envían contraseñas, usuarios ni datos de tus clientes.</p>
    </div>
    <?php
}

add_filter('plugin_action_links_' . plugin_basename(__FILE__), function ($enlaces) {
    array_unshift($enlaces, '<a href="' . esc_url(admin_url('options-general.php?page=webcare')) . '">Ajustes</a>');
    return $enlaces;
});
