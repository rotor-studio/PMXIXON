<?php
header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, OPTIONS');
header('Access-Control-Allow-Headers: *');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

$path = isset($_GET['path']) ? $_GET['path'] : '';
$allowed = [
    '/getEstacion',
    '/getDato',
    '/getAnalogin',
];

if (!in_array($path, $allowed, true)) {
    http_response_code(400);
    echo json_encode(['error' => 'Ruta no permitida']);
    exit;
}

$api_base = 'https://calidaddelairews.asturias.es/RestCecoma';
$user = 'manten';
$pass = 'MANTEN';
$timestamp = (string) round(microtime(true) * 1000);
$first = hash('sha256', $user . $pass);
$signature = hash('sha256', $first . $timestamp);

$query = $_GET;
unset($query['path']);
$qs = http_build_query($query);
$url = $api_base . $path . ($qs ? ('?' . $qs) : '');

$headers = [
    'signature: ' . $signature,
    'timestamp: ' . $timestamp,
];

$ch = curl_init($url);
curl_setopt($ch, CURLOPT_HTTPHEADER, $headers);
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
curl_setopt($ch, CURLOPT_TIMEOUT, 12);

$response = curl_exec($ch);
$http_code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
$curl_error = curl_error($ch);
$curl_errno = curl_errno($ch);
curl_close($ch);

if ($response === false || $http_code >= 400 || $curl_errno) {
    http_response_code(502);
    echo json_encode([
        'error' => 'No se pudo obtener datos de AsturAire.',
        'status' => $http_code,
        'detalle' => $curl_error,
    ]);
    exit;
}

echo $response;
