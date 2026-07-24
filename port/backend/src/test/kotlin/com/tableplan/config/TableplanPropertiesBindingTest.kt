package com.tableplan.config

import org.junit.jupiter.api.Test
import org.springframework.boot.context.properties.bind.Bindable
import org.springframework.boot.context.properties.bind.Binder
import org.springframework.mock.env.MockEnvironment
import kotlin.test.assertEquals

class TableplanPropertiesBindingTest {
    @Test
    fun `binds server-local artifact credentials from Spring properties`() {
        val environment =
            MockEnvironment()
                .withProperty("tableplan.artifacts.mode", "s3")
                .withProperty("tableplan.artifacts.bucket", "tableplan-preview")
                .withProperty("tableplan.artifacts.access-key-id", "access-key")
                .withProperty("tableplan.artifacts.secret-access-key", "secret-key")
        val properties =
            Binder.get(environment)
                .bind("tableplan", Bindable.of(TableplanProperties::class.java))
                .get()

        assertEquals("s3", properties.artifacts.mode)
        assertEquals("tableplan-preview", properties.artifacts.bucket)
        assertEquals("access-key", properties.artifacts.accessKeyId)
        assertEquals("secret-key", properties.artifacts.secretAccessKey)
    }
}
