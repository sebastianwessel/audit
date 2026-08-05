<?php

function exportImage(array $request): object
{
    $width = (int) $request['width'];
    $height = (int) $request['height'];
    return imagecreatetruecolor($width, $height);
}
