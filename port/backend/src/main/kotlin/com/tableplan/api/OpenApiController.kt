package com.tableplan.api

import org.springframework.core.io.ClassPathResource
import org.springframework.http.MediaType
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.RestController
import tools.jackson.dataformat.yaml.YAMLMapper

@RestController
class OpenApiController {
    private val yaml = YAMLMapper.builder().build()

    @GetMapping("/api/v1/openapi.json", produces = [MediaType.APPLICATION_JSON_VALUE])
    fun contract(): Map<*, *> =
        ClassPathResource("contracts/openapi.yaml").inputStream.use {
            yaml.readValue(it, Map::class.java)
        }
}
